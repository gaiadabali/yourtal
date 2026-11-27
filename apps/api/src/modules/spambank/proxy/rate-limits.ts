import type { RateLimitService } from "../../../shared/rate-limit/rate-limit.service";

/**
 * Per-mailbox limits of the mail API (spambank/BUILD.md §4.3), counted on the shared Valkey through
 * the app's `RateLimitService`. Keyed by mailbox, not by token or address: a person with three apps
 * open shares one budget, and minting new tokens does not reset it.
 */

export type MailBucket = "api" | "upload" | "safe_html" | "unsubscribe";

const WINDOWS: Readonly<Record<MailBucket, { max: number; windowSeconds: number }>> = {
  api: { max: 600, windowSeconds: 60 },
  upload: { max: 30, windowSeconds: 60 },
  safe_html: { max: 300, windowSeconds: 60 },
  unsubscribe: { max: 20, windowSeconds: 3600 },
};

export interface MailRateLimiter {
  /** True when the request may go ahead. Throws when the counter store is down (not fail-open). */
  allow(bucket: MailBucket, mailboxId: string, ip: string): Promise<boolean>;
}

export function mailRateLimiter(service: RateLimitService): MailRateLimiter {
  return {
    async allow(bucket, mailboxId, ip) {
      const verdict = await service.consume(
        { routeId: `spambank.mail.${bucket}`, identityId: mailboxId, ip },
        { identity: WINDOWS[bucket] },
      );
      return !verdict.blocked;
    },
  };
}

/** For tests and local runs without Valkey. */
export function unlimited(): MailRateLimiter {
  return { allow: () => Promise.resolve(true) };
}
