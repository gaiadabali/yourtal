import type { AutoreplyMode } from "@yourtal/contracts/spambank/common";
import { senderInputFromJmap } from "../classify/jmap-input";
import { classifySender } from "../classify/sender-checks";
import type { ClassifyConfig, SenderClassification } from "../classify/sender-checks";
import { cleanText } from "./db";
import type { MailboxRow, Queryable } from "./db";
import type { Folder } from "./folders";
import { hasKeyword } from "./jmap-email";
import type { IngestEmail } from "./jmap-email";
import { recordLead } from "./leads";
import { offerStatements } from "./offers";
import type { SnapappTarget } from "./outbox";

/** §4.6 check 1: an auto-reply is never sent for mail that arrived more than 48 hours ago. */
export const AUTOREPLY_MAX_AGE_MS = 48 * 60 * 60 * 1000;
/** §4.9 / §5.5: an alert is only worth sending while it is fresh; the event itself expires after 15 minutes. */
export const ALERT_MAX_AGE_MS = 15 * 60 * 1000;

export interface ProcessContext {
  readonly classify: ClassifyConfig;
  readonly autoreplyMode: AutoreplyMode;
  /** `spambank.control.paused_at` is set. */
  readonly paused: boolean;
  /** The person's SnapApp sub, when they have one with live consent. */
  readonly snapapp: SnapappTarget | null;
  readonly now: Date;
}

export type ProcessOutcome =
  | { readonly status: "ignored"; readonly reason: "not_incoming" | "draft" }
  | { readonly status: "duplicate" }
  | {
      readonly status: "processed";
      readonly folder: Folder;
      readonly decision: string;
      /** Ingest queued nothing itself; the caller sends `spambank.autoreply` for these. */
      readonly queueAutoreply: boolean;
      readonly lead: boolean;
      readonly offered: number;
      readonly statementEventQueued: boolean;
      /** A fresh, unread Inbox message from somebody else: counts toward the new-mail alert (§4.9). */
      readonly newInbox: boolean;
    };

function ownAddress(mailbox: Pick<MailboxRow, "local_part" | "domain">): string {
  return `${mailbox.local_part}@${mailbox.domain}`.toLowerCase();
}

/**
 * The `ingested_message.autoreply_decision` ingest can settle itself, in §4.6's order (checks 0, 1, then
 * 2-7 from the classifier), or `queued` for T7's job to take on, which re-reads the message and runs the
 * whole list again, adding checks 8-10 (domain opt-out, 30-day throttle, daily cap).
 */
export function autoreplyDecision(
  mailbox: Pick<MailboxRow, "local_part" | "domain">,
  folder: Folder,
  classification: SenderClassification,
  receivedAt: Date,
  context: Pick<ProcessContext, "autoreplyMode" | "paused" | "now">,
): string {
  if (context.autoreplyMode === "off") return "disabled";
  if (context.paused) return "paused";
  // Spam is filtered mail, not a person's: replying to it would be backscatter at whoever forged it.
  if (folder !== "inbox" && folder !== "junk") return "not_inbound";
  if (classification.fromAddress?.toLowerCase() === ownAddress(mailbox)) return "not_inbound";
  if (context.now.getTime() - receivedAt.getTime() > AUTOREPLY_MAX_AGE_MS) return "stale";
  if (!classification.autoreply.eligible) return classification.autoreply.code;
  return "queued";
}

/**
 * One new message, in one transaction (the caller opens it): the idempotency row first, so a message seen
 * twice (the webhook job and the reconcile, or a re-read after a crash) does nothing the second time; then
 * the lead, the statement offers and their event. Mail that is not incoming (Sent, Drafts, Trash, other
 * folders) and drafts leave no trace at all.
 */
export async function processMessage(
  db: Queryable,
  mailbox: MailboxRow,
  email: IngestEmail,
  folder: Folder,
  context: ProcessContext,
): Promise<ProcessOutcome> {
  if (hasKeyword(email, "$draft")) return { status: "ignored", reason: "draft" };
  if (folder === "other") return { status: "ignored", reason: "not_incoming" };

  const receivedAt = email.receivedAt ?? context.now;
  const classification = classifySender(senderInputFromJmap(email), context.classify);
  const decision = autoreplyDecision(mailbox, folder, classification, receivedAt, context);

  const claimed = await db.query(
    `INSERT INTO spambank.ingested_message
       (mailbox_id, email_id, received_at, folder, bulk, dmarc_pass, from_org_domain, autoreply_decision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
    [
      mailbox.id,
      email.id,
      receivedAt,
      folder,
      classification.bulk,
      classification.dmarcPass,
      classification.fromOrgDomain,
      decision,
    ],
  );
  if ((claimed.rowCount ?? 0) === 0) return { status: "duplicate" };

  // §4.7 and the done-when: filtered mail (the Spam folder) never makes a lead.
  let lead = false;
  if (folder !== "spam" && classification.lead.eligible) {
    await recordLead(db, mailbox, {
      orgDomain: classification.lead.orgDomain,
      fromAddress: classification.fromAddress,
      displayName: cleanText(email.from?.[0]?.name, 120),
      subject: email.subject,
      hasListUnsubscribe: classification.hasListUnsubscribe,
      seenAt: receivedAt,
    });
    lead = true;
  }

  const offer = await offerStatements(
    db,
    mailbox,
    {
      emailId: email.id,
      receivedAt,
      folder,
      dmarcPass: classification.dmarcPass,
      attachments: email.attachments,
    },
    context.snapapp,
    context.now,
  );

  const fresh = context.now.getTime() - receivedAt.getTime() <= ALERT_MAX_AGE_MS;
  return {
    status: "processed",
    folder,
    decision,
    queueAutoreply: decision === "queued",
    lead,
    offered: offer.offered,
    statementEventQueued: offer.eventQueued,
    newInbox:
      folder === "inbox" &&
      fresh &&
      !hasKeyword(email, "$seen") &&
      classification.fromAddress?.toLowerCase() !== ownAddress(mailbox),
  };
}
