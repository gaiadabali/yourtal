import { cleanText } from "./db";
import type { MailboxRow, Queryable } from "./db";
import { enqueueStatementEvent } from "./outbox";
import type { SnapappTarget } from "./outbox";
import { statementCandidates } from "../classify/statement-attachments";
import type { AttachmentPartInput } from "../classify/statement-attachments";
import type { Folder } from "./folders";

/**
 * BUILD.md §4.8 steps 2-3: a mailed PDF or CSV statement is OFFERED to SnapApp, which fetches the bytes
 * itself through the machine route. Only offered (email, blob) pairs can ever be fetched, so the offer rows
 * are the whole access list: a mailbox with the switch off, a message in Spam, one that did not pass DMARC
 * and a file that is not a statement leave no row and so cannot be reached.
 */
export interface OfferInput {
  readonly emailId: string;
  readonly receivedAt: Date;
  readonly folder: Folder;
  readonly dmarcPass: boolean;
  readonly attachments: readonly AttachmentPartInput[];
}

export interface OfferResult {
  readonly offered: number;
  /** Why nothing was offered (`switch_off`, `in_spam`, `unauthenticated`, `no_candidates`), if so. */
  readonly skipped: string | null;
  readonly eventQueued: boolean;
}

export async function offerStatements(
  db: Queryable,
  mailbox: Pick<MailboxRow, "id" | "statements_to_snapapp">,
  input: OfferInput,
  snapapp: SnapappTarget | null,
  now: Date,
): Promise<OfferResult> {
  const decision = statementCandidates({
    enabled: mailbox.statements_to_snapapp,
    // Only Inbox and Junk mail is the person's incoming mail: Spam, Sent, Drafts and Trash are not offered.
    inSpam: input.folder !== "inbox" && input.folder !== "junk",
    dmarcPass: input.dmarcPass,
    attachments: input.attachments,
  });
  if (!decision.ok) return { offered: 0, skipped: decision.reason, eventQueued: false };

  const offered: { blobId: string; name: string; type: string; size: number }[] = [];
  for (const part of decision.offers) {
    const blobId = part.blobId;
    if (typeof blobId !== "string" || part.size === null || part.size === undefined) continue;
    const name = cleanText(part.name, 255) ?? "statement";
    const type = (cleanText(part.type, 100) ?? "application/octet-stream").toLowerCase();
    const inserted = await db.query(
      `INSERT INTO spambank.statement_offer (mailbox_id, email_id, blob_id, name, type, size)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [mailbox.id, input.emailId, blobId, name, type, Math.trunc(part.size)],
    );
    if ((inserted.rowCount ?? 0) > 0)
      offered.push({ blobId, name, type, size: Math.trunc(part.size) });
  }
  if (offered.length === 0) return { offered: 0, skipped: "already_offered", eventQueued: false };
  if (snapapp === null) return { offered: offered.length, skipped: null, eventQueued: false };

  await enqueueStatementEvent(
    db,
    snapapp,
    {
      email_id: input.emailId,
      received_at: input.receivedAt.toISOString(),
      attachments: offered.map((o) => ({
        blob_id: o.blobId,
        name: o.name,
        type: o.type,
        size: o.size,
      })),
    },
    now,
  );
  return { offered: offered.length, skipped: null, eventQueued: true };
}
