import { senderInputFromJmap } from "../classify/jmap-input";
import { classifySender } from "../classify/sender-checks";
import type { ClassifyConfig } from "../classify/sender-checks";
import type { MailboxRow } from "../ingest/db";
import type { Folder } from "../ingest/folders";
import { hasKeyword } from "../ingest/jmap-email";
import type { IngestEmail } from "../ingest/jmap-email";
import { AUTOREPLY_MAX_AGE_MS } from "../ingest/process-message";

/**
 * BUILD.md §4.6 checks 1 to 7 for one message, re-read from Stalwart by the job (ingest's verdict is never
 * trusted on its own: the message may have moved, and this is the last look before mail leaves). Checks 0
 * and 8-10 need the database and run in `claim.ts`. No I/O.
 */

/** Every `ingested_message.autoreply_decision` the job writes. */
export type AutoreplyDecision =
  | "disabled"
  | "paused"
  | "not_inbound"
  | "stale"
  | "unauthenticated"
  | "not_bulk"
  | "auto_or_bounce"
  | "noreply_address"
  | "own_domain"
  | "freemail"
  | "invalid_address"
  | "opted_out"
  | "throttled"
  | "daily_cap"
  | "would_send"
  | "redirected"
  | "sent"
  | "send_failed";

/** Ingest's hand-over value, and the job's own "claimed, now sending" mark. */
export const QUEUED = "queued";
export const SENDING = "sending" as const;

export type PreCheck =
  | { readonly ok: false; readonly decision: AutoreplyDecision }
  | { readonly ok: true; readonly target: string; readonly orgDomain: string };

export function preCheck(input: {
  readonly mailbox: Pick<MailboxRow, "local_part" | "domain">;
  readonly email: IngestEmail;
  readonly folder: Folder;
  readonly receivedAt: Date;
  readonly classify: ClassifyConfig;
  readonly now: Date;
}): PreCheck {
  const { email, folder, mailbox } = input;
  // Check 1: inbound only. Spam is filtered mail (replying to it is backscatter); Sent, Drafts and Trash
  // and anything the person filed are `other`.
  if (folder !== "inbox" && folder !== "junk") return { ok: false, decision: "not_inbound" };
  if (hasKeyword(email, "$draft")) return { ok: false, decision: "not_inbound" };
  if (input.now.getTime() - input.receivedAt.getTime() > AUTOREPLY_MAX_AGE_MS) {
    return { ok: false, decision: "stale" };
  }
  const classification = classifySender(senderInputFromJmap(email), input.classify);
  const own = `${mailbox.local_part}@${mailbox.domain}`.toLowerCase();
  if (classification.fromAddress?.toLowerCase() === own)
    return { ok: false, decision: "not_inbound" };
  // Checks 2-7, in order, from the classifier (T3).
  const verdict = classification.autoreply;
  if (!verdict.eligible) return { ok: false, decision: verdict.code };
  return { ok: true, target: verdict.target, orgDomain: verdict.orgDomain };
}

/** UTC calendar day of `now`, the key of `spambank.autoreply_day`. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
