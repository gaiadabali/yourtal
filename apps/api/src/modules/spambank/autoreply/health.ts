import type { SpambankDriver } from "@yourtal/drivers/spambank";
import type { Queryable } from "../ingest/db";
import { JmapProblem, call, isRecord, jmapAccountId, resultOf } from "../ingest/jmap-session";
import { REPLY_LOCAL_PART, SYSTEM_LOCAL_PARTS } from "./mailer";
import type { Alerter } from "./pause";
import { pauseOnThresholds, pausedAlertText } from "./pause";
import { DONE_KEYWORD } from "./reply-inbox";

/**
 * `spambank.health` (BUILD.md T7 "health"), every 5 minutes:
 * - the system accounts exist (`reply`, `abuse`, `postmaster` on the reply domain, U12's fallback);
 * - `SPAMBANK_AUTOREPLY_DAILY_CAP` is the cap until staff first change the control row;
 * - the auto-pause thresholds (also checked after each reply-inbox run);
 * - housekeeping: reply-inbox bookkeeping older than 30 days, the reply account's Sent copies older than 7
 *   days and its processed mail older than 30 days (each reply carries a 330 KB banner).
 */

const LEDGER_DAYS = 30;
const SENT_KEEP_DAYS = 7;
const DESTROY_BATCH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface HealthDeps {
  readonly db: Queryable;
  readonly driver: SpambankDriver;
  readonly replyDomain: string;
  readonly quotaBytes: number;
  readonly dailyCap: number;
  readonly alerter: Alerter;
  readonly now: Date;
  readonly log?: (message: string) => void;
}

export interface HealthResult {
  /** Per system account: `ok`, `created` or `failed:<code>`; empty once known to exist. */
  readonly accounts: Readonly<Record<string, string>>;
  readonly capSeeded: boolean;
  readonly pausedReason: string | null;
  readonly purged: number;
}

/** Creates each system account that is missing. `already_exists` is the normal answer. */
export async function ensureSystemAccounts(
  driver: SpambankDriver,
  replyDomain: string,
  quotaBytes: number,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const local of SYSTEM_LOCAL_PARTS) {
    const made = await driver.createAccount({ localPart: local, domain: replyDomain, quotaBytes });
    out[local] = made.isOk()
      ? "created"
      : made.error.code === "already_exists"
        ? "ok"
        : `failed:${made.error.code}`;
  }
  return out;
}

export async function seedDailyCap(db: Queryable, cap: number): Promise<boolean> {
  const result = await db.query(
    `UPDATE spambank.control SET daily_cap = $1 WHERE updated_by IS NULL AND daily_cap <> $1`,
    [cap],
  );
  return (result.rowCount ?? 0) > 0;
}

async function destroyOld(
  driver: SpambankDriver,
  local: string,
  replyDomain: string,
  filter: (inboxId: string, sentId: string | undefined) => Record<string, unknown> | null,
): Promise<number> {
  const client = driver.account(local, replyDomain);
  const accountId = await jmapAccountId(client);
  const boxes = await call(client, [["Mailbox/get", { accountId, properties: ["role"] }, "m"]]);
  const list = resultOf(boxes, "m")["list"];
  const roles = Array.isArray(list) ? list.filter(isRecord) : [];
  const id = (role: string): string | undefined => {
    const found = roles.find((m) => m["role"] === role)?.["id"];
    return typeof found === "string" ? found : undefined;
  };
  const inboxId = id("inbox");
  if (inboxId === undefined) return 0;
  const condition = filter(inboxId, id("sent"));
  if (condition === null) return 0;
  const found = await call(client, [
    ["Email/query", { accountId, filter: condition, limit: DESTROY_BATCH }, "q"],
  ]);
  const ids = resultOf(found, "q")["ids"];
  const doomed = Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : [];
  if (doomed.length === 0) return 0;
  await call(client, [["Email/set", { accountId, destroy: doomed }, "d"]]);
  return doomed.length;
}

/** Drivers whose system accounts are known to exist: asked once per process, not every 5 minutes. */
const ensured = new WeakSet<SpambankDriver>();

export async function runHealth(deps: HealthDeps): Promise<HealthResult> {
  const log = deps.log ?? ((message: string) => console.error(message));
  let accounts: Record<string, string> = {};
  if (!ensured.has(deps.driver)) {
    accounts = await ensureSystemAccounts(deps.driver, deps.replyDomain, deps.quotaBytes);
    const failed = Object.entries(accounts).filter(([, v]) => v.startsWith("failed"));
    if (failed.length > 0) log(`[spambank] health: system accounts ${JSON.stringify(accounts)}`);
    else ensured.add(deps.driver);
  }

  const capSeeded = await seedDailyCap(deps.db, deps.dailyCap);
  const pausedReason = await pauseOnThresholds(deps.db, deps.now);
  if (pausedReason !== null)
    await deps.alerter.alert("auto-reply paused", pausedAlertText(pausedReason));

  const purged = await deps.db.query(
    `DELETE FROM spambank.reply_inbox_message WHERE processed_at < $1`,
    [new Date(deps.now.getTime() - LEDGER_DAYS * DAY_MS)],
  );
  const sentBefore = new Date(deps.now.getTime() - SENT_KEEP_DAYS * DAY_MS).toISOString();
  const readBefore = new Date(deps.now.getTime() - LEDGER_DAYS * DAY_MS).toISOString();
  for (const local of SYSTEM_LOCAL_PARTS) {
    try {
      if (local === REPLY_LOCAL_PART) {
        await destroyOld(deps.driver, local, deps.replyDomain, (_inbox, sent) =>
          sent === undefined ? null : { inMailbox: sent, before: sentBefore },
        );
      }
      await destroyOld(deps.driver, local, deps.replyDomain, (inbox) => ({
        inMailbox: inbox,
        hasKeyword: DONE_KEYWORD,
        before: readBefore,
      }));
    } catch (error) {
      if (!(error instanceof JmapProblem)) throw error;
    }
  }
  return { accounts, capSeeded, pausedReason, purged: purged.rowCount ?? 0 };
}
