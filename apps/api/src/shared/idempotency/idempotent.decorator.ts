import { SetMetadata } from "@nestjs/common";

/**
 * Marks a route as requiring an `Idempotency-Key`. YT-0039 AC2.
 *
 * `docs/10` §226 calls for *"a shared table and decorator, mandatory on every
 * value-moving endpoint"*. This is the decorator; `@yourtal/idempotency` is
 * the shared table.
 *
 * The rule is enforced the other way round from how it sounds: rather than
 * hunting for endpoints that should have it, `mutating-routes.test.ts` fails
 * the build for any mutating route (`@Post`, `@Put`, `@Patch`, `@Delete`)
 * carrying NEITHER this NOR `@NotValueMoving`. A new endpoint cannot be added
 * without someone deciding which it is, which is the only version of
 * "mandatory" that survives contact with a deadline.
 */
export const IDEMPOTENT_METADATA = "yt:idempotent";
export const NOT_VALUE_MOVING_METADATA = "yt:not-value-moving";

export interface IdempotentOptions {
  /**
   * How long the key stays claimed and its response replayable.
   *
   * Per-endpoint, never global. `docs/14` §6 replays a merchant redemption
   * for 24h; `docs/12` keeps a voucher key for the voucher's own lifetime
   * plus a 30-day late-arrival interval. A single global TTL would silently
   * expire a voucher key that a merchant's retry queue drains a week later,
   * and the replay would become a second issuance.
   */
  readonly retentionMs: number;
}

export const Idempotent = (options: IdempotentOptions) => SetMetadata(IDEMPOTENT_METADATA, options);

/**
 * Declares that a mutating route moves no value, so it needs no idempotency
 * key. Takes a reason, which is the point: the reason is what a reviewer
 * reads when deciding whether the exemption is still true.
 *
 * Use this sparingly and never for convenience. `docs/09` §214: *"Idempotency
 * key mandatory on every call. Retries are certain; double-spends must be
 * impossible."* If a retry of the endpoint could create a second anything a
 * user would notice, it is not exempt.
 */
export const NotValueMoving = (reason: string) => SetMetadata(NOT_VALUE_MOVING_METADATA, reason);
