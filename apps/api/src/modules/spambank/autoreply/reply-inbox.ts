import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Pool } from "pg";
import type { SpambankAccountClient, SpambankDriver } from "@yourtal/drivers/spambank";
import {
  JmapProblem,
  call,
  downloadPath,
  isRecord,
  readSession,
  resultOf,
} from "../ingest/jmap-session";
import type { JmapSession } from "../ingest/jmap-session";
import { utcDay } from "./decide";
import { SYSTEM_LOCAL_PARTS } from "./mailer";
import { optOutDomain } from "./optout";
import type { Alerter } from "./pause";
import { pauseOnThresholds, pausedAlertText } from "./pause";
import { classifyReplyMessage } from "./reply-report";
import type { ReplyReport } from "./reply-report";

/**
 * `spambank.reply-inbox` (BUILD.md §4.6 "Bounces and complaints"): reads new mail of `reply@`, `abuse@` and
 * `postmaster@` on the reply domain (separate accounts: U12's fallback), and per message, in one
 * transaction with its idempotency row (`reply_inbox_message`):
 *
 * - bounce of one of our replies → that reply `bounced`, today's `bounces + 1`;
 * - complaint → the named reply `complained` and its domain opted out, today's `complaints + 1`;
 * - a person answering → the sender's domain (and the answered reply's domain) opted out;
 * - anything automatic → nothing.
 *
 * Then the thresholds: over one, the replies pause and `SPAMBANK_ALERT_EMAILS` is told. Read mail is
 * marked `$spambank_done` so the next run skips it; the idempotency row makes a re-read harmless.
 */

export const DONE_KEYWORD = "$spambank_done";
const PAGE = 50;
const RAW_MAX_BYTES = 1024 * 1024;

export interface ReplyInboxDeps {
  readonly pool: Pool;
  readonly driver: SpambankDriver;
  readonly replyDomain: string;
  readonly alerter: Alerter;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}

export interface ReplyInboxResult {
  readonly read: number;
  readonly counted: Readonly<Record<ReplyReport["kind"], number>>;
  readonly unavailable: readonly string[];
  readonly pausedReason: string | null;
}

async function readRaw(
  client: SpambankAccountClient,
  session: JmapSession,
  blobId: string,
): Promise<string> {
  const response = await client.fetch(
    downloadPath(session, blobId, "message.eml", "message/rfc822"),
  );
  if (response.isErr()) throw new JmapProblem(response.error.code, response.error.detail);
  if (!response.value.ok || response.value.body === null) {
    await response.value.body?.cancel();
    throw new JmapProblem("unavailable", `download answered ${String(response.value.status)}`);
  }
  // Node's stream view of the body: read until the cap, then stop (a DSN can quote a 25 MB message).
  const stream = Readable.fromWeb(response.value.body as WebReadableStream<Uint8Array>);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    chunks.push(buffer);
    size += buffer.length;
    if (size >= RAW_MAX_BYTES) {
      stream.destroy();
      break;
    }
  }
  return Buffer.concat(chunks).subarray(0, RAW_MAX_BYTES).toString("latin1");
}

/** Records one message; false when it was already counted. */
export async function recordReport(
  pool: Pool,
  login: string,
  emailId: string,
  report: ReplyReport,
  now: Date,
): Promise<boolean> {
  const db = await pool.connect();
  let broken = false;
  try {
    await db.query("BEGIN");
    let orgDomain: string | null = null;
    if (report.autoreplyId !== null) {
      const named = await db.query<{ org_domain: string }>(
        "SELECT org_domain FROM spambank.autoreply WHERE id = $1",
        [report.autoreplyId],
      );
      orgDomain = named.rows[0]?.org_domain ?? null;
    }
    const answeredDomain = report.kind === "answer" ? report.fromOrgDomain : null;
    const fresh = await db.query(
      `INSERT INTO spambank.reply_inbox_message (login, email_id, kind, autoreply_id, org_domain, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [
        login,
        emailId,
        report.kind,
        orgDomain === null ? null : report.autoreplyId,
        orgDomain ?? answeredDomain,
        now,
      ],
    );
    if ((fresh.rowCount ?? 0) === 0) {
      await db.query("ROLLBACK");
      return false;
    }
    const day = utcDay(now);
    if (report.kind === "bounce" && orgDomain !== null) {
      const bounced = await db.query(
        `UPDATE spambank.autoreply SET status = 'bounced'
          WHERE id = $1 AND status IN ('sent', 'queued')`,
        [report.autoreplyId],
      );
      if ((bounced.rowCount ?? 0) > 0) {
        await db.query(
          `INSERT INTO spambank.autoreply_day AS d (day, bounces) VALUES ($1::date, 1)
           ON CONFLICT (day) DO UPDATE SET bounces = d.bounces + 1`,
          [day],
        );
      }
    }
    if (report.kind === "complaint") {
      if (orgDomain !== null) {
        await db.query(
          "UPDATE spambank.autoreply SET status = 'complained' WHERE id = $1 AND status <> 'complained'",
          [report.autoreplyId],
        );
        await optOutDomain(db, orgDomain, now);
      }
      // Counted even when it names no reply of ours: a complaint is the costliest signal there is.
      await db.query(
        `INSERT INTO spambank.autoreply_day AS d (day, complaints) VALUES ($1::date, 1)
         ON CONFLICT (day) DO UPDATE SET complaints = d.complaints + 1`,
        [day],
      );
    }
    if (report.kind === "answer") {
      for (const domain of new Set([answeredDomain, orgDomain])) {
        if (domain !== null) await optOutDomain(db, domain, now);
      }
    }
    await db.query("COMMIT");
    return true;
  } catch (error) {
    broken = true;
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    db.release(broken);
  }
}

async function readAccount(
  deps: ReplyInboxDeps,
  local: string,
  counted: Record<ReplyReport["kind"], number>,
): Promise<number> {
  const client = deps.driver.account(local, deps.replyDomain);
  const now = deps.now ?? (() => new Date());
  const session = await readSession(client);
  const accountId = session.accountId;
  const boxes = await call(client, [["Mailbox/get", { accountId, properties: ["role"] }, "m"]]);
  const listed = resultOf(boxes, "m")["list"];
  const inbox = Array.isArray(listed)
    ? listed.filter(isRecord).find((m) => m["role"] === "inbox")
    : undefined;
  const inboxId = typeof inbox?.["id"] === "string" ? inbox["id"] : undefined;
  if (inboxId === undefined) throw new JmapProblem("rejected", `${local}@ has no Inbox`);
  const found = await call(client, [
    [
      "Email/query",
      {
        accountId,
        filter: { inMailbox: inboxId, notKeyword: DONE_KEYWORD },
        sort: [{ property: "receivedAt", isAscending: true }],
        limit: PAGE,
      },
      "q",
    ],
  ]);
  const ids = resultOf(found, "q")["ids"];
  const emailIds = Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : [];
  if (emailIds.length === 0) return 0;
  const got = await call(client, [
    ["Email/get", { accountId, ids: emailIds, properties: ["id", "blobId"] }, "g"],
  ]);
  const emails = resultOf(got, "g")["list"];
  let read = 0;
  for (const entry of Array.isArray(emails) ? emails.filter(isRecord) : []) {
    const id = entry["id"];
    const blobId = entry["blobId"];
    if (typeof id !== "string" || typeof blobId !== "string") continue;
    const report = classifyReplyMessage(await readRaw(client, session, blobId), deps.replyDomain);
    if (await recordReport(deps.pool, client.login, id, report, now())) {
      counted[report.kind] += 1;
      (deps.log ?? (() => undefined))(
        `[spambank] reply-inbox ${local}@: ${report.kind} (${report.detail})`,
      );
    }
    read += 1;
    await call(client, [
      ["Email/set", { accountId, update: { [id]: { [`keywords/${DONE_KEYWORD}`]: true } } }, "k"],
    ]);
  }
  return read;
}

export async function processReplyInbox(deps: ReplyInboxDeps): Promise<ReplyInboxResult> {
  const log = deps.log ?? ((message: string) => console.error(message));
  const counted: Record<ReplyReport["kind"], number> = {
    bounce: 0,
    complaint: 0,
    answer: 0,
    ignored: 0,
  };
  const unavailable: string[] = [];
  let read = 0;
  for (const local of SYSTEM_LOCAL_PARTS) {
    try {
      read += await readAccount({ ...deps, log }, local, counted);
    } catch (error) {
      if (!(error instanceof JmapProblem)) throw error;
      unavailable.push(`${local}:${error.code}`);
    }
  }
  if (unavailable.length > 0)
    log(`[spambank] reply-inbox could not read ${unavailable.join(", ")}`);
  const pausedReason = await pauseOnThresholds(deps.pool, (deps.now ?? (() => new Date()))());
  if (pausedReason !== null)
    await deps.alerter.alert("auto-reply paused", pausedAlertText(pausedReason));
  return { read, counted, unavailable, pausedReason };
}
