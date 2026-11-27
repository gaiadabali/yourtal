import * as z from "zod";
import { receiversFor } from "../oidc/event-receivers";
import type { EventReceiver, ReceiverEnvironment } from "../oidc/event-receivers";

/**
 * Spambank's inbound pipeline (spambank/BUILD.md §4.8, §4.9, §5.2, §5.5): the two signed events sent to
 * SnapApp, the queues and job data of ingest, and the two machine routes SnapApp's server calls to fetch an
 * offered statement and to report what it did with it.
 */

/** §5.5: the events SnapApp receives. FTR receives none. */
export const SPAMBANK_MAIL_EVENT = "urn:yourtal:event:spambank-mail";
export const SPAMBANK_STATEMENT_EVENT = "urn:yourtal:event:spambank-statement";

/** §5.5 expiry: an alert is stale after 15 minutes, a statement offer after 24 hours; then `failed_at`. */
export const SPAMBANK_EVENT_TTL_SECONDS = {
  mail: 15 * 60,
  statement: 24 * 60 * 60,
} as const;

/** §4.9: at most one new-mail alert per mailbox per 2 minutes. */
export const NEW_MAIL_ALERT_COALESCE_SECONDS = 120;

/** `{"events": {"urn:yourtal:event:spambank-mail": {"unread_inbox": 3}}}` */
export const spambankMailEventSchema = z.object({
  unread_inbox: z.number().int().min(0).max(1_000_000),
});
export type SpambankMailEvent = z.infer<typeof spambankMailEventSchema>;

export const spambankStatementEventSchema = z.object({
  email_id: z.string().min(1).max(255),
  received_at: z.iso.datetime({ offset: true }),
  attachments: z
    .array(
      z.object({
        blob_id: z.string().min(1).max(255),
        name: z.string().max(255),
        type: z.string().min(1).max(127),
        size: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(10),
});
export type SpambankStatementEvent = z.infer<typeof spambankStatementEventSchema>;

/**
 * pg-boss queues. Named here so the API (which enqueues from the webhook), the worker and T7 agree.
 * `autoreply` and `replyInbox` belong to T7: ingest only sends to them.
 */
export const SPAMBANK_QUEUES = {
  /** `{ mailboxId }`: read one mailbox's new mail. */
  ingest: "spambank.ingest",
  /** Every minute, and on a webhook the receiver could not map to one mailbox. */
  reconcile: "spambank.reconcile",
  /** Mail delivered to the system `reply` account (bounces, complaints, answers). */
  replyInbox: "spambank.reply-inbox",
  /** `{ mailboxId, emailId }`: decide and maybe send one auto-reply. */
  autoreply: "spambank.autoreply",
  eventDelivery: "spambank.app-event-delivery",
  purge: "spambank.purge",
  /** T7: re-queues `queued` decisions whose job was lost. */
  autoreplySweep: "spambank.autoreply-sweep",
  /** T7: system accounts, the daily cap, the auto-pause thresholds, housekeeping. */
  health: "spambank.health",
  /** T7: the daily DNS blocklist check. */
  blocklist: "spambank.blocklist",
} as const;

/** §5.4: the webhook's per-mailbox ingest jobs are debounced to one per 2 seconds. */
export const INGEST_DEBOUNCE_SECONDS = 2;

const mailboxIdSchema = z.uuid();

export const spambankIngestJobSchema = z.object({ mailboxId: mailboxIdSchema });
export type SpambankIngestJob = z.infer<typeof spambankIngestJobSchema>;

export const spambankAutoreplyJobSchema = z.object({
  mailboxId: mailboxIdSchema,
  emailId: z.string().min(1).max(255),
});
export type SpambankAutoreplyJob = z.infer<typeof spambankAutoreplyJobSchema>;

/** The Stalwart (JMAP) ids of a message and of one of its parts: URL-safe, short. */
export const JMAP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const subSchema = z.string().min(1).max(255);
const jmapIdSchema = z.string().min(1).max(255).regex(JMAP_ID_PATTERN);

/** §5.2 `POST /api/oidc-clients/spambank/attachments/fetch`. */
export const attachmentFetchRequestSchema = z
  .object({ sub: subSchema, emailId: jmapIdSchema, blobId: jmapIdSchema })
  .strict();
export type AttachmentFetchRequest = z.infer<typeof attachmentFetchRequestSchema>;

/** §5.2 `statement_offer.outcome`. */
export const STATEMENT_OUTCOMES = ["imported", "duplicate", "failed", "skipped"] as const;
export type StatementOutcome = (typeof STATEMENT_OUTCOMES)[number];

/** §5.2 `POST /api/oidc-clients/spambank/statements/ack`. */
export const statementAckRequestSchema = z
  .object({
    sub: subSchema,
    emailId: jmapIdSchema,
    blobId: jmapIdSchema,
    outcome: z.enum(STATEMENT_OUTCOMES),
    detail: z.string().max(500).optional(),
  })
  .strict();
export type StatementAckRequest = z.infer<typeof statementAckRequestSchema>;

/**
 * The receiver the mail events go to: SnapApp's server client, in whichever sector this environment
 * signs it in under. Undefined where no SnapApp receiver is registered (production, today).
 */
export function snapappReceiver(environment: ReceiverEnvironment): EventReceiver | undefined {
  return receiversFor(environment).find((receiver) => receiver.sector.startsWith("snapapp"));
}
