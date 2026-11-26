import * as z from "zod";

/**
 * Spambank (BUILD.md §4.3, §5): the vocabulary every part of it shares. The mail token's payload,
 * the error codes of §5, the address rule of §4.1 and the auto-reply modes of §4.6.
 */

/** The apps that can mint a mail token (`a` in the token). */
export const SPAMBANK_APPS = ["yourtal", "snapapp", "ftr"] as const;
export type SpambankApp = (typeof SPAMBANK_APPS)[number];

export const SPAMBANK_REGIONS = ["AU", "ID"] as const;
export type SpambankRegion = (typeof SPAMBANK_REGIONS)[number];

/** `spambank.mailbox.status`. */
export const MAILBOX_STATUSES = ["provisioning", "active", "suspended", "erasing"] as const;
export type MailboxStatus = (typeof MAILBOX_STATUSES)[number];

/** What `GET /api/spambank/me` tells a screen. */
export const MAILBOX_STATES = ["off", "on", "suspended", "not_allowed"] as const;
export type MailboxState = (typeof MAILBOX_STATES)[number];

/** §4.1: lower-case ASCII, 6-16 letters, a two-digit suffix only as a fallback. */
export const LOCAL_PART_PATTERN = /^[a-z]{6,16}([1-9][0-9])?$/;

/** §5: every error is `{ code, message }`. */
export const SPAMBANK_ERROR_CODES = [
  "unknown_subject",
  "not_allowed",
  "not_enabled",
  "spambank_unavailable",
  "rate_limited",
  "unauthorized",
  "method_not_allowed",
  "envelope_required",
  "too_many_recipients",
  "daily_send_cap",
  "upstream_auth",
] as const;
export type SpambankErrorCode = (typeof SPAMBANK_ERROR_CODES)[number];

export const spambankErrorSchema = z.object({
  code: z.enum(SPAMBANK_ERROR_CODES),
  message: z.string().min(1).max(500),
});
export type SpambankError = z.infer<typeof spambankErrorSchema>;

/** §4.6: `off` is the hard switch; `dry_run` records the decision and sends nothing. */
export const AUTOREPLY_MODES = ["off", "dry_run", "redirect", "live"] as const;
export type AutoreplyMode = (typeof AUTOREPLY_MODES)[number];

/** §4.3: the mail token's version prefix and lifetime. Engines refresh 2 minutes before expiry. */
export const MAIL_TOKEN_PREFIX = "sbm1";
export const MAIL_TOKEN_TTL_SECONDS = 30 * 60;

/** 16 random bytes, base64url without padding. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** The signed JSON inside a mail token: `{v:1, m, u, a, exp, n}`. */
export const mailTokenPayloadSchema = z
  .object({
    v: z.literal(1),
    /** `spambank.mailbox.id`. */
    m: z.uuid(),
    /** The YourTal account (`identity.user_profile` id). */
    u: z.string().min(1).max(64),
    a: z.enum(SPAMBANK_APPS),
    /** Expiry, unix seconds. */
    exp: z.number().int().positive(),
    n: z.string().regex(NONCE_PATTERN),
  })
  .strict();
export type MailTokenPayload = z.infer<typeof mailTokenPayloadSchema>;

/** §5.1 `POST /api/spambank/me/session`. */
export const mailSessionSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
  sessionUrl: z.url(),
  helpersBase: z.url(),
  address: z.email(),
});
export type MailSession = z.infer<typeof mailSessionSchema>;
