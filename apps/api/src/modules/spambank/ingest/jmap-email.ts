import * as z from "zod";
import { JMAP_SENDER_PROPERTIES } from "../classify/jmap-input";
import type { JmapSenderFields } from "../classify/jmap-input";
import type { AttachmentPartInput } from "../classify/statement-attachments";

/**
 * What ingest asks Stalwart for, and the answer parsed. No I/O. The sender headers come from
 * `JMAP_SENDER_PROPERTIES` (BUILD.md §7.1: the `:all` forms, because plain `asText` returns only the LAST
 * instance of a header and a sender could append `Auto-Submitted: no`).
 *
 * Parsing is lenient about everything but the id and strict about what it trusts: a header that is not the
 * shape asked for reads as absent, and an absent `Authentication-Results` is `unauthenticated`
 * (the classifier fails closed), never a crash that would leave the message unprocessed.
 */

/** Every property of `Email/get` ingest reads. */
export const INGEST_EMAIL_PROPERTIES: readonly string[] = [
  "id",
  "mailboxIds",
  "keywords",
  "receivedAt",
  "subject",
  "attachments",
  ...JMAP_SENDER_PROPERTIES,
];

/** Body parts need only these: `bodyStructure` is read for its top-level type, `attachments` for the files. */
export const INGEST_BODY_PROPERTIES: readonly string[] = [
  "partId",
  "blobId",
  "size",
  "name",
  "type",
  "disposition",
];

export interface IngestEmail extends JmapSenderFields {
  readonly id: string;
  readonly mailboxIds: Readonly<Record<string, boolean>>;
  readonly keywords: Readonly<Record<string, boolean>>;
  readonly receivedAt: Date | null;
  readonly subject: string | null;
  readonly attachments: readonly AttachmentPartInput[];
}

const address = z.object({
  name: z.string().nullish().catch(null),
  email: z.string().nullish().catch(null),
});
const text = z.string().nullish().catch(undefined);
const textAll = z.array(z.string()).nullish().catch(undefined);
const flags = z.record(z.string(), z.boolean()).catch({});
const part = z.object({
  blobId: z.string().nullish().catch(null),
  name: z.string().nullish().catch(null),
  type: z.string().nullish().catch(null),
  size: z.number().nullish().catch(null),
});

/** One property per sender header, with the exact keys `JMAP_SENDER_PROPERTIES` lists. */
const emailShape = z.object({
  id: z.string().min(1),
  mailboxIds: flags,
  keywords: flags,
  receivedAt: z.string().nullish().catch(null),
  subject: text,
  attachments: z.array(part).nullish().catch(null),
  from: z.array(address).nullish().catch(null),
  replyTo: z.array(address).nullish().catch(null),
  bodyStructure: z.object({ type: text }).nullish().catch(null),
  "header:From:asAddresses:all": z.array(z.unknown()).nullish().catch(undefined),
  "header:Authentication-Results:asText:all": textAll,
  "header:List-Unsubscribe:asText:all": textAll,
  "header:List-Unsubscribe:asURLs": z.array(z.string()).nullish().catch(undefined),
  "header:List-Id:asText:all": textAll,
  "header:Precedence:asText:all": textAll,
  "header:Auto-Submitted:asText:all": textAll,
  "header:X-Autoreply:asText:all": textAll,
  "header:X-Autorespond:asText:all": textAll,
  "header:X-Auto-Response-Suppress:asText:all": textAll,
  "header:Return-Path:asText:all": textAll,
});

/** One `Email/get` list entry, or null when it has no usable id. */
export function parseEmail(raw: unknown): IngestEmail | null {
  const parsed = emailShape.safeParse(raw);
  if (!parsed.success) return null;
  const e = parsed.data;
  const received =
    e.receivedAt === null || e.receivedAt === undefined ? null : new Date(e.receivedAt);
  return {
    ...e,
    receivedAt: received === null || Number.isNaN(received.getTime()) ? null : received,
    subject: e.subject ?? null,
    attachments: e.attachments ?? [],
  };
}

/** Parses every entry of an `Email/get` `list`, dropping the unusable ones. */
export function parseEmails(list: unknown): IngestEmail[] {
  if (!Array.isArray(list)) return [];
  const found: IngestEmail[] = [];
  for (const raw of list) {
    const email = parseEmail(raw);
    if (email !== null) found.push(email);
  }
  return found;
}

/** Stalwart returns the keyword in this exact spelling (RFC 8621 §4.1.1). */
export function hasKeyword(email: IngestEmail, keyword: string): boolean {
  return email.keywords[keyword] === true;
}
