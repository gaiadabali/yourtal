import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AutoreplyMode } from "@yourtal/contracts/spambank/common";
import type { SpambankDriver } from "@yourtal/drivers/spambank";
import type { ClassifyConfig } from "../classify/sender-checks";
import { MAILBOX_COLUMNS } from "../ingest/db";
import type { MailboxRow } from "../ingest/db";
import { folderOf, mailboxFolders, parseMailboxes } from "../ingest/folders";
import { INGEST_BODY_PROPERTIES, INGEST_EMAIL_PROPERTIES, parseEmail } from "../ingest/jmap-email";
import { JmapProblem, call, isRecord, jmapAccountId, resultOf } from "../ingest/jmap-session";
import { MOCK_ABN_LINE, formatAbn } from "./abn";
import { claimAutoreply, recordDecision } from "./claim";
import type { AutoreplyDecision } from "./decide";
import { QUEUED, SENDING, preCheck } from "./decide";
import type { SystemMailer } from "./mailer";
import { autoreplyMessageId, buildAutoreplyMessage } from "./message";
import { optoutLinks } from "./optout";

/**
 * One `spambank.autoreply {mailboxId, emailId}` job (BUILD.md F4, §4.6). Ingest settled checks 0-7 once and
 * wrote `queued`; this re-reads the message and runs every check again (0-7 here, 0 and 8-10 in the claim),
 * then sends at most one reply. Idempotent: anything but `queued` on the message row means another run
 * decided already. A Stalwart that cannot be reached before the claim leaves the row `queued` for the
 * sweep to retry within the 48 hours.
 */

export interface AutoreplySettings {
  readonly mode: AutoreplyMode;
  readonly redirectTo?: string;
  readonly replyDomain: string;
  readonly optoutKey?: string;
  readonly publicOrigin: string;
  /** 11 digits, or null for the mock line. */
  readonly abn: string | null;
  readonly contactEmail: string;
}

export interface AutoreplyDeps {
  readonly pool: Pool;
  readonly driver: SpambankDriver;
  readonly mailer: SystemMailer;
  readonly classify: ClassifyConfig;
  readonly settings: AutoreplySettings;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly log?: (message: string) => void;
}

export type AutoreplyRunResult =
  | { readonly status: "skipped"; readonly reason: "not_queued" | "unavailable" }
  | { readonly status: "decided"; readonly decision: AutoreplyDecision };

const ERROR_MAX = 300;

export function abnLine(abn: string | null): string {
  return abn === null ? MOCK_ABN_LINE : formatAbn(abn);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

interface Original {
  readonly messageIds: string[];
  readonly references: string[];
}

async function decide(
  deps: AutoreplyDeps,
  mailboxId: string,
  emailId: string,
  decision: AutoreplyDecision,
): Promise<AutoreplyRunResult> {
  const recorded = await recordDecision(deps.pool, mailboxId, emailId, decision);
  return recorded ? { status: "decided", decision } : { status: "skipped", reason: "not_queued" };
}

export async function runAutoreply(
  deps: AutoreplyDeps,
  job: { readonly mailboxId: string; readonly emailId: string },
): Promise<AutoreplyRunResult> {
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? ((message: string) => console.error(message));
  const { mailboxId, emailId } = job;
  const { settings } = deps;

  const row = await deps.pool.query<{ autoreply_decision: string; received_at: Date }>(
    `SELECT autoreply_decision, received_at FROM spambank.ingested_message
      WHERE mailbox_id = $1 AND email_id = $2`,
    [mailboxId, emailId],
  );
  const ingested = row.rows[0];
  if (ingested?.autoreply_decision !== QUEUED) return { status: "skipped", reason: "not_queued" };

  // Check 0, first pass (the claim repeats the database half inside its transaction).
  if (settings.mode === "off") return decide(deps, mailboxId, emailId, "disabled");
  const control = await deps.pool.query<{ tripped: boolean; paused: boolean }>(
    "SELECT tripped_at IS NOT NULL AS tripped, paused_at IS NOT NULL AS paused FROM spambank.control",
  );
  const state = control.rows[0];
  if (state === undefined || state.tripped) return decide(deps, mailboxId, emailId, "disabled");
  if (state.paused) return decide(deps, mailboxId, emailId, "paused");

  const boxes = await deps.pool.query<MailboxRow>(
    `SELECT ${MAILBOX_COLUMNS} FROM spambank.mailbox WHERE id = $1`,
    [mailboxId],
  );
  const mailbox = boxes.rows[0];
  if (mailbox?.status !== "active") return decide(deps, mailboxId, emailId, "not_inbound");

  // Re-read the message as the mailbox: where it is now, and its headers.
  const client = deps.driver.account(mailbox.local_part, mailbox.domain);
  let email: ReturnType<typeof parseEmail>;
  let original: Original;
  let folder: ReturnType<typeof folderOf>;
  try {
    const accountId = await jmapAccountId(client);
    const responses = await call(client, [
      ["Mailbox/get", { accountId, properties: ["role", "name"] }, "m"],
      [
        "Email/get",
        {
          accountId,
          ids: [emailId],
          properties: [...INGEST_EMAIL_PROPERTIES, "messageId", "references"],
          bodyProperties: INGEST_BODY_PROPERTIES,
        },
        "e",
      ],
    ]);
    const list = resultOf(responses, "e")["list"];
    const raw: unknown = Array.isArray(list) ? list[0] : undefined;
    email = parseEmail(raw);
    original = {
      messageIds: isRecord(raw) ? strings(raw["messageId"]) : [],
      references: isRecord(raw) ? strings(raw["references"]) : [],
    };
    const folders = mailboxFolders(
      parseMailboxes(resultOf(responses, "m")["list"]),
      mailbox.junk_mailbox_id,
    );
    folder = email === null ? "other" : folderOf(email, folders);
  } catch (error) {
    if (!(error instanceof JmapProblem)) throw error;
    log(`[spambank] autoreply: mailbox ${mailboxId} unreadable (${error.code}); left queued`);
    return { status: "skipped", reason: "unavailable" };
  }
  // Gone (deleted or expunged since ingest): nothing to answer.
  if (email === null) return decide(deps, mailboxId, emailId, "not_inbound");

  const check = preCheck({
    mailbox,
    email,
    folder,
    receivedAt: email.receivedAt ?? ingested.received_at,
    classify: deps.classify,
    now,
  });
  if (!check.ok) return decide(deps, mailboxId, emailId, check.decision);

  const sends = settings.mode === "redirect" || settings.mode === "live";
  const to = settings.mode === "redirect" ? settings.redirectTo : check.target;
  if (sends) {
    if (to === undefined || settings.optoutKey === undefined) {
      // The config refuses to boot like this; a test wiring that forgets is a bug, not a reply.
      throw new Error(
        "auto-reply sending needs SPAMBANK_AUTOREPLY_REDIRECT_TO/SPAMBANK_OPTOUT_KEY",
      );
    }
    try {
      await deps.mailer.prepare();
    } catch (error) {
      log(
        `[spambank] autoreply: the reply account is not usable (${error instanceof JmapProblem ? error.code : "error"}); left queued`,
      );
      return { status: "skipped", reason: "unavailable" };
    }
  }

  const id = (deps.newId ?? randomUUID)();
  const messageId = autoreplyMessageId(id, settings.replyDomain);
  const db = await deps.pool.connect();
  let broken = false;
  let claim: Awaited<ReturnType<typeof claimAutoreply>>;
  try {
    claim = await claimAutoreply(db, {
      mailboxId,
      emailId,
      orgDomain: check.orgDomain,
      mode: settings.mode,
      ...(sends && to !== undefined ? { reply: { id, toAddress: to, messageId } } : {}),
      now,
    });
  } catch (error) {
    broken = true;
    throw error;
  } finally {
    db.release(broken);
  }
  if (claim.status === "not_queued") return { status: "skipped", reason: "not_queued" };
  if (claim.status === "decided") return { status: "decided", decision: claim.decision };
  if (to === undefined || settings.optoutKey === undefined) throw new Error("unreachable");

  // Claimed: build and send exactly once.
  const message = buildAutoreplyMessage({
    id,
    replyDomain: settings.replyDomain,
    to,
    ...(settings.mode === "redirect" ? { redirectedFrom: check.target } : {}),
    originalMessageIds: original.messageIds,
    originalReferences: original.references,
    optout: optoutLinks(settings.publicOrigin, settings.optoutKey, check.orgDomain),
    abnLine: abnLine(settings.abn),
    contactEmail: settings.contactEmail,
    date: now,
  });
  const sent = await deps.mailer.send(message.raw, [to]);
  const decision: AutoreplyDecision = sent.ok
    ? settings.mode === "redirect"
      ? "redirected"
      : "sent"
    : "send_failed";
  await deps.pool.query(
    `UPDATE spambank.autoreply
        SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN $3::timestamptz END, error = $4
      WHERE id = $1 AND status = 'queued'`,
    [
      id,
      sent.ok ? "sent" : "send_failed",
      (deps.now ?? (() => new Date()))(),
      sent.ok ? null : `${sent.code}: ${sent.detail}`.slice(0, ERROR_MAX),
    ],
  );
  await recordDecision(deps.pool, mailboxId, emailId, decision, SENDING);
  if (!sent.ok) {
    log(`[spambank] autoreply ${id} to ${check.orgDomain} failed: ${sent.code}`);
  }
  return { status: "decided", decision };
}
