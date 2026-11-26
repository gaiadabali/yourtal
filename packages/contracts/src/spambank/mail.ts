import * as z from "zod";
import { SPAMBANK_ERROR_CODES } from "./common";

/**
 * Spambank's mail API (BUILD.md §5.3): what the proxy at `/api/spambank/jmap/*` and the helpers at
 * `/api/spambank/mail/*` answer. Every caller holds a mail token; the shared mail engine
 * (`@snap/mail-engine`) is the client. The JMAP routes speak JMAP itself (RFC 8620/8621), so only
 * the helpers and the proxy's own refusals have shapes here.
 */

/** Where the mail API lives below the public origin. */
export const SPAMBANK_JMAP_PREFIX = "/api/spambank/jmap";
export const SPAMBANK_MAIL_PREFIX = "/api/spambank/mail";

/** §4.3: the JMAP capabilities a client may name in `using`. */
export const ALLOWED_JMAP_CAPABILITIES = [
  "urn:ietf:params:jmap:core",
  "urn:ietf:params:jmap:mail",
  "urn:ietf:params:jmap:submission",
  "urn:ietf:params:jmap:quota",
] as const;

/** §4.3: the JMAP methods a client may call. Anything else refuses the whole request. */
export const ALLOWED_JMAP_METHODS = [
  "Core/echo",
  "Mailbox/get",
  "Mailbox/changes",
  "Mailbox/query",
  "Mailbox/queryChanges",
  "Email/get",
  "Email/changes",
  "Email/query",
  "Email/queryChanges",
  "Email/set",
  "Thread/get",
  "Thread/changes",
  "SearchSnippet/get",
  "Identity/get",
  "EmailSubmission/get",
  "EmailSubmission/changes",
  "EmailSubmission/query",
  "EmailSubmission/set",
  "Quota/get",
] as const;

/** §4.3 send caps. */
export const MAX_RECIPIENTS_PER_SUBMISSION = 10;
export const MAX_RECIPIENTS_PER_DAY = 100;

/** The proxy's error codes: §5's common ones plus what only the mail API says. */
export const MAIL_API_ERROR_CODES = [
  ...SPAMBANK_ERROR_CODES,
  "not_found",
  "invalid_request",
  "payload_too_large",
  "too_many_streams",
] as const;
export type MailApiErrorCode = (typeof MAIL_API_ERROR_CODES)[number];

export const mailApiErrorSchema = z.object({
  code: z.enum(MAIL_API_ERROR_CODES),
  message: z.string().min(1).max(500),
});
export type MailApiError = z.infer<typeof mailApiErrorSchema>;

/** `GET /api/spambank/mail/summary?locale=`: the banner on top of Spam, and the counters. */
export const mailSummarySchema = z.object({
  address: z.email(),
  folders: z.object({
    /** The `junk`-role mailbox, shown as Spam. Null when Stalwart could not be asked. */
    spamMailboxId: z.string().min(1).nullable(),
    /** The custom "Junk" mailbox bulk mail is filed into (§4.2). */
    junkMailboxId: z.string().min(1).nullable(),
  }),
  counters: z.object({
    bulkFiled30d: z.number().int().nonnegative(),
    marketersUnsubscribed: z.number().int().nonnegative(),
    autoRepliesSent30d: z.number().int().nonnegative(),
  }),
  banner: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    ctaLabel: z.string().min(1),
    ctaUrl: z.url(),
  }),
});
export type MailSummaryResponse = z.infer<typeof mailSummarySchema>;

/** `GET /api/spambank/mail/messages/:emailId/safe-html` (§4.4). */
export const safeHtmlSchema = z.object({
  /** Sanitised: no script, no remote URL; images only as `data:`. */
  html: z.string(),
  remoteImagesBlocked: z.number().int().nonnegative(),
  inlineImagesDropped: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type SafeHtmlResponse = z.infer<typeof safeHtmlSchema>;

/** `POST /api/spambank/mail/messages/:emailId/unsubscribe` (§4.5). */
export const unsubscribeRequestSchema = z.object({ moveToJunk: z.boolean().optional() }).strict();
export type UnsubscribeRequest = z.infer<typeof unsubscribeRequestSchema>;

export const UNSUBSCRIBE_STATUSES = ["done", "open_link", "failed", "unavailable"] as const;
export const UNSUBSCRIBE_METHODS = ["one_click", "mailto", "link"] as const;

export const unsubscribeResultSchema = z.object({
  status: z.enum(UNSUBSCRIBE_STATUSES),
  method: z.enum(UNSUBSCRIBE_METHODS).optional(),
  /** Only with `open_link`: the https page the person opens themselves. */
  url: z.url().optional(),
});
export type UnsubscribeResult = z.infer<typeof unsubscribeResultSchema>;

/**
 * The public URLs a mail session names (§5.1 `sessionUrl`, `helpersBase`), from the public origin
 * of the API (`https://yourtal.gaiada.com`).
 */
export function mailUrlsFor(publicOrigin: string): { sessionUrl: string; helpersBase: string } {
  const origin = publicOrigin.replace(/\/+$/, "");
  return {
    sessionUrl: `${origin}${SPAMBANK_JMAP_PREFIX}/session`,
    helpersBase: `${origin}${SPAMBANK_MAIL_PREFIX}`,
  };
}
