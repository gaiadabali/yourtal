export const VERIFICATION_TOKEN_REPOSITORY = Symbol("VERIFICATION_TOKEN_REPOSITORY");

export type VerificationPurpose = "password_reset" | "email_verification";

/**
 * Why a consume attempt did not succeed. Kept distinct internally for the
 * same reason `checkpoint-nonce.repository.ts`'s `SpendRefusal` is: a
 * security review wants to tell a replay of a used link from a link that
 * simply expired from one that was never issued at all (a forgery, or a
 * typo). YT-0153's enumeration discipline still applies at the HTTP
 * boundary — `to-http-exception.ts` collapses all three to one message —
 * but collapsing them before they are even distinguished would throw the
 * information away before anything gets a chance to log it.
 */
export type ConsumeRefusal = "not_found" | "already_consumed" | "expired";

export type ConsumeResult =
  | { readonly consumed: true; readonly userId: string }
  | { readonly consumed: false; readonly refusal: ConsumeRefusal };

export interface VerificationTokenRepository {
  create(input: {
    id: string;
    userId: string;
    purpose: VerificationPurpose;
    expiresAt: Date;
  }): Promise<void>;

  /**
   * Attempts to spend a token in one atomic statement — there is no
   * separate `get`, for the same reason `CheckpointNonceRepository.spend`
   * has none: a read-then-write pair lets two concurrent presentations of
   * one token both observe "not yet consumed" and both succeed, which is
   * exactly the replay `consumed_at` exists to prevent.
   */
  consume(id: string, purpose: VerificationPurpose, now: Date): Promise<ConsumeResult>;

  /** Past `expiresAt`. Scheduled, never on the request path. */
  pruneExpired(now: Date): Promise<number>;
}
