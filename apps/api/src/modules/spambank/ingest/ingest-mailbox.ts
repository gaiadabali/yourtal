import type { Pool, PoolClient } from "pg";
import type { AutoreplyMode } from "@yourtal/contracts/spambank/common";
import { NEW_MAIL_ALERT_COALESCE_SECONDS } from "@yourtal/contracts/spambank/events";
import type { EventReceiver } from "@yourtal/contracts/oidc/event-receivers";
import type { SpambankAccountClient, SpambankDriver } from "@yourtal/drivers/spambank";
import type { ClassifyConfig } from "../classify/sender-checks";
import { MAILBOX_COLUMNS } from "./db";
import { JmapProblem, call, isRecord, jmapAccountId, resultOf } from "./jmap-session";
import type { MailboxRow } from "./db";
import { folderOf, mailboxFolders, parseMailboxes } from "./folders";
import { INGEST_BODY_PROPERTIES, INGEST_EMAIL_PROPERTIES, parseEmails } from "./jmap-email";
import { enqueueMailEvent, snapappTargetFor } from "./outbox";
import type { SnapappTarget } from "./outbox";
import { processMessage } from "./process-message";
import type { ProcessContext } from "./process-message";

/**
 * Reads one mailbox's new mail and records it (BUILD.md F3, B5). The same function serves the webhook's
 * `spambank.ingest` job and the 1-minute reconcile, so the webhook is never the only road in: a lost or
 * misparsed webhook only delays a message by a minute.
 *
 * - **One run per mailbox at a time**, by a Postgres advisory lock held on one connection for the run (a
 *   second run for the same mailbox returns `locked` and leaves it to the first).
 * - **State.** `spambank.mailbox.email_state` is the JMAP Email state already read. `Email/changes` since it
 *   lists the new ids; the state is saved after each page, so a crash re-reads at most one page, and every
 *   message is recorded under its own idempotency row (`ingested_message`), so a re-read changes nothing.
 * - A state Stalwart can no longer calculate from (`cannotCalculateChanges`) is replaced by a fresh state and
 *   the last 48 hours of mail, which the idempotency rows make safe to re-read.
 * - A Stalwart that is down is not an error: the run says `unavailable` and the next minute tries again.
 */

const PAGE = 50;
const MAX_PAGES = 20;
/** The fallback window after a lost state: also the longest a mail can wait and still be auto-replied to. */
const RESYNC_WINDOW_MS = 48 * 60 * 60 * 1000;
const RESYNC_LIMIT = 200;

export interface IngestDeps {
  readonly pool: Pool;
  readonly driver: SpambankDriver;
  readonly classify: ClassifyConfig;
  readonly autoreplyMode: AutoreplyMode;
  /** SnapApp's receiver in this environment (`snapappReceiver`); undefined sends it nothing. */
  readonly receiver: EventReceiver | undefined;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}

export interface IngestResult {
  readonly status: "ok" | "locked" | "skipped" | "unavailable";
  readonly detail?: string;
  /** Messages newly recorded. */
  readonly processed: number;
  /** For `spambank.autoreply` jobs (T7); ingest only names them. */
  readonly autoreplyEmailIds: readonly string[];
  /** Outbox rows written: the caller kicks the delivery job when this is above zero. */
  readonly eventsQueued: number;
}

const EMPTY: Omit<IngestResult, "status"> = {
  processed: 0,
  autoreplyEmailIds: [],
  eventsQueued: 0,
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** A failure Postgres reports for the connection or the moment, not for the message. */
export function isTransientDbError(error: unknown): boolean {
  const code = isRecord(error) ? error["code"] : undefined;
  if (typeof code !== "string") return true;
  return /^(08|53|57|40)/.test(code);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

class Run {
  processed = 0;
  eventsQueued = 0;
  newInbox = 0;
  unreadInbox: number | null = null;
  readonly autoreplyEmailIds: string[] = [];

  constructor(
    private readonly deps: IngestDeps,
    private readonly db: PoolClient,
    private readonly mailbox: MailboxRow,
    private readonly client: SpambankAccountClient,
    private readonly accountId: string,
    private readonly context: ProcessContext,
    private readonly log: (message: string) => void,
  ) {}

  /** `Mailbox/get` + `Email/get` for a page of ids, each message recorded in its own transaction. */
  async processIds(ids: readonly string[]): Promise<void> {
    for (const page of chunks(ids, PAGE)) {
      const responses = await call(this.client, [
        [
          "Mailbox/get",
          { accountId: this.accountId, properties: ["role", "name", "unreadEmails"] },
          "m",
        ],
        [
          "Email/get",
          {
            accountId: this.accountId,
            ids: page,
            properties: INGEST_EMAIL_PROPERTIES,
            bodyProperties: INGEST_BODY_PROPERTIES,
          },
          "e",
        ],
      ]);
      const folders = mailboxFolders(
        parseMailboxes(resultOf(responses, "m")["list"]),
        this.mailbox.junk_mailbox_id,
      );
      if (folders.unreadInbox !== null) this.unreadInbox = folders.unreadInbox;
      const emails = parseEmails(resultOf(responses, "e")["list"]).sort(
        (a, b) => (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0),
      );
      for (const email of emails) {
        await this.db.query("BEGIN");
        try {
          const outcome = await processMessage(
            this.db,
            this.mailbox,
            email,
            folderOf(email, folders),
            { ...this.context, now: (this.deps.now ?? (() => new Date()))() },
          );
          await this.db.query("COMMIT");
          if (outcome.status !== "processed") continue;
          this.processed += 1;
          if (outcome.statementEventQueued) this.eventsQueued += 1;
          if (outcome.queueAutoreply) this.autoreplyEmailIds.push(email.id);
          if (outcome.newInbox) this.newInbox += 1;
        } catch (error) {
          await this.db.query("ROLLBACK").catch(() => undefined);
          // A message that cannot be recorded (a bad value) is skipped and logged; a database that is
          // away stops the run before the state moves, so nothing is lost.
          if (isTransientDbError(error)) throw error;
          this.log(
            `[spambank] ingest skipped one message of ${this.mailbox.id}: ` +
              (error instanceof Error ? error.message : "unknown error"),
          );
        }
      }
    }
  }

  async saveState(state: string, now: Date): Promise<void> {
    await this.db.query(
      "UPDATE spambank.mailbox SET email_state = $2, last_ingested_at = $3, updated_at = $3 WHERE id = $1",
      [this.mailbox.id, state, now],
    );
  }

  /** The current Email state, with nothing read (JMAP `Email/get` with no ids). */
  async currentState(): Promise<string> {
    const responses = await call(this.client, [
      ["Email/get", { accountId: this.accountId, ids: [], properties: ["id"] }, "s"],
    ]);
    const state = resultOf(responses, "s")["state"];
    if (typeof state !== "string" || state === "") {
      throw new JmapProblem("unavailable", "Email/get returned no state");
    }
    return state;
  }

  /** A state Stalwart cannot continue from: take a fresh one and re-read the last 48 hours. */
  async resync(now: Date): Promise<void> {
    const since = new Date(now.getTime() - RESYNC_WINDOW_MS).toISOString();
    const responses = await call(this.client, [
      ["Email/get", { accountId: this.accountId, ids: [], properties: ["id"] }, "s"],
      [
        "Email/query",
        {
          accountId: this.accountId,
          filter: { after: since },
          sort: [{ property: "receivedAt", isAscending: true }],
          limit: RESYNC_LIMIT,
        },
        "q",
      ],
    ]);
    const state = resultOf(responses, "s")["state"];
    if (typeof state !== "string" || state === "") {
      throw new JmapProblem("unavailable", "Email/get returned no state");
    }
    await this.processIds(strings(resultOf(responses, "q")["ids"]));
    await this.saveState(state, now);
  }

  /** §4.9: at most one alert per mailbox per 2 minutes, claimed atomically so two runs cannot both send. */
  async alert(snapapp: SnapappTarget | null, now: Date): Promise<void> {
    if (this.newInbox === 0 || snapapp === null || !this.mailbox.new_mail_alerts) return;
    const claimed = await this.db.query(
      `UPDATE spambank.mailbox SET last_alert_at = $2
        WHERE id = $1 AND (last_alert_at IS NULL
                           OR last_alert_at < $2::timestamptz - make_interval(secs => $3))`,
      [this.mailbox.id, now, NEW_MAIL_ALERT_COALESCE_SECONDS],
    );
    if ((claimed.rowCount ?? 0) === 0) return;
    await enqueueMailEvent(
      this.db,
      snapapp,
      { unread_inbox: Math.max(this.unreadInbox ?? 0, this.newInbox) },
      now,
    );
    this.eventsQueued += 1;
  }
}

async function loadMailbox(db: PoolClient, mailboxId: string): Promise<MailboxRow | undefined> {
  const { rows } = await db.query<MailboxRow>(
    `SELECT ${MAILBOX_COLUMNS} FROM spambank.mailbox WHERE id = $1`,
    [mailboxId],
  );
  return rows[0];
}

function problemResult(
  error: JmapProblem,
  mailboxId: string,
  log: (m: string) => void,
): IngestResult {
  // `upstream_auth` means our derived credential was refused: a misconfigured key. Worth an error line.
  const level = error.code === "upstream_auth" ? "error" : "warning";
  log(`[spambank] ingest ${level} for ${mailboxId}: ${error.code}`);
  return { status: "unavailable", detail: error.code, ...EMPTY };
}

async function runLocked(
  deps: IngestDeps,
  db: PoolClient,
  mailboxId: string,
): Promise<IngestResult> {
  const log = deps.log ?? ((message: string) => console.error(message));
  const now = deps.now ?? (() => new Date());
  const mailbox = await loadMailbox(db, mailboxId);
  if (mailbox === undefined) return { status: "skipped", detail: "no_mailbox", ...EMPTY };
  if (mailbox.status !== "active") return { status: "skipped", detail: "not_active", ...EMPTY };

  const client = deps.driver.account(mailbox.local_part, mailbox.domain);
  const start = now();
  try {
    const accountId = await jmapAccountId(client);
    const control = await db.query<{ paused: boolean }>(
      "SELECT paused_at IS NOT NULL AS paused FROM spambank.control",
    );
    const snapapp = await snapappTargetFor(db, mailbox.user_id, deps.receiver);
    const context: ProcessContext = {
      classify: deps.classify,
      autoreplyMode: deps.autoreplyMode,
      paused: control.rows[0]?.paused === true,
      snapapp,
      now: start,
    };
    const run = new Run(deps, db, mailbox, client, accountId, context, log);

    if (mailbox.email_state === null) {
      // Provisioning did not record a starting state: begin now, with nothing from before.
      await run.saveState(await run.currentState(), start);
    } else {
      let since = mailbox.email_state;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const responses = await call(client, [
          ["Email/changes", { accountId, sinceState: since, maxChanges: PAGE }, "c"],
        ]);
        let result: Record<string, unknown>;
        try {
          result = resultOf(responses, "c");
        } catch (error) {
          if (error instanceof JmapProblem && error.code === "cannotCalculateChanges") {
            log(`[spambank] ingest: state lost for ${mailboxId}; re-reading the last 48 hours`);
            await run.resync(now());
            break;
          }
          throw error;
        }
        const created = strings(result["created"]);
        const newState = result["newState"];
        if (typeof newState !== "string" || newState === "") {
          throw new JmapProblem("unavailable", "Email/changes returned no new state");
        }
        if (created.length > 0) await run.processIds(created);
        if (newState !== since) await run.saveState(newState, now());
        since = newState;
        if (result["hasMoreChanges"] !== true) break;
      }
    }
    await run.alert(snapapp, now());
    return {
      status: "ok",
      processed: run.processed,
      autoreplyEmailIds: run.autoreplyEmailIds,
      eventsQueued: run.eventsQueued,
    };
  } catch (error) {
    if (error instanceof JmapProblem) return problemResult(error, mailboxId, log);
    throw error;
  }
}

/** Never throws for Stalwart trouble; a database that is away does throw, so pg-boss retries the job. */
export async function ingestMailbox(deps: IngestDeps, mailboxId: string): Promise<IngestResult> {
  const db = await deps.pool.connect();
  let locked = false;
  let broken = false;
  try {
    const got = await db.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('spambank.ingest'), hashtext($1)) AS locked",
      [mailboxId],
    );
    locked = got.rows[0]?.locked === true;
    if (!locked) return { status: "locked", ...EMPTY };
    return await runLocked(deps, db, mailboxId);
  } catch (error) {
    broken = true;
    throw error;
  } finally {
    if (locked) {
      try {
        await db.query("SELECT pg_advisory_unlock(hashtext('spambank.ingest'), hashtext($1))", [
          mailboxId,
        ]);
      } catch {
        broken = true;
      }
    }
    // A connection that threw may hold a lock or an open transaction: close it instead of reusing it.
    db.release(broken);
  }
}
