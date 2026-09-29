import { SetMetadata } from "@nestjs/common";
import type { RateLimitPolicy } from "./rate-limit.service";

/**
 * Declares a route's rate limits. YT-0052 AC2.
 *
 * The `routeId` is explicit rather than derived from the URL, and that is
 * the important part of this decorator. Deriving it from the request path
 * would give `/api/store/:listingId/redeem` a different counter per
 * listing, so the per-route limit — the one that bounds the endpoint's
 * total cost — would silently become a per-listing limit and bound nothing
 * an attacker cares about. An explicit id also survives a route being
 * renamed without quietly resetting every counter in flight.
 */
export const RATE_LIMIT_METADATA = "yt:rate-limit";
export const NO_RATE_LIMIT_METADATA = "yt:no-rate-limit";

export interface RateLimitOptions extends RateLimitPolicy {
  /** Stable identifier for this route's counters. Never the URL. */
  readonly routeId: string;
}

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_METADATA, options);

/**
 * Declares that a route is deliberately unlimited, with a reason.
 *
 * Same shape and same purpose as `@NotValueMoving` next door in
 * `idempotency/`: the reason is what a reviewer reads when deciding whether
 * the exemption is still true. An exemption without one is indistinguishable
 * from an oversight six weeks later.
 */
export const NoRateLimit = (reason: string) => SetMetadata(NO_RATE_LIMIT_METADATA, reason);

/**
 * Limits for the three routes YT-0052 names by name, kept here rather than
 * inline so the numbers sit next to each other and can be compared.
 *
 * These are starting values chosen to be clearly above legitimate human use
 * and clearly below what makes an attack cheap. They are not derived from
 * production traffic, because there is none yet — stated plainly so nobody
 * later reads them as measured.
 */

/**
 * Registration. The per-IP limit is the operative one: creating accounts is
 * the thing being bounded and an attacker has no identity yet by
 * definition. The route limit is a backstop against a distributed signup
 * flood, set high enough that a genuine launch-day burst does not trip it.
 */
export const REGISTER_RATE_LIMIT: RateLimitOptions = {
  routeId: "auth.register",
  ip: { max: 5, windowSeconds: 60 * 60 },
  route: { max: 500, windowSeconds: 60 * 60 },
};

/**
 * Login. Deliberately looser per-IP than registration, because
 * `ThrottleService` is already doing the precise work here — counting
 * FAILED attempts per account and per source. This limit exists for what
 * that one cannot see: the cost of the requests themselves, including the
 * Argon2id verify on every attempt that reaches it. Setting this as tight
 * as the failure throttle would lock out a shared office address whose
 * users are all logging in successfully.
 */
export const LOGIN_RATE_LIMIT: RateLimitOptions = {
  routeId: "auth.login",
  ip: { max: 30, windowSeconds: 15 * 60 },
  route: { max: 2000, windowSeconds: 15 * 60 },
};

/**
 * Password reset request. The tightest limit in this file, and the route
 * that most needs one: every call succeeds and every call sends an email,
 * so `ThrottleService`'s failure counter bounds it not at all. Limited on
 * all three dimensions — an authenticated caller triggering resets is as
 * much a mail bomb as an anonymous one.
 */
export const PASSWORD_RESET_REQUEST_RATE_LIMIT: RateLimitOptions = {
  routeId: "auth.password.reset.request",
  ip: { max: 3, windowSeconds: 60 * 60 },
  identity: { max: 3, windowSeconds: 60 * 60 },
  route: { max: 200, windowSeconds: 60 * 60 },
};

/**
 * Email verification request. Same shape and same reason as password
 * reset — it sends mail on every success — but authenticated, so the
 * identity dimension is the one that does the work.
 */
export const EMAIL_VERIFY_REQUEST_RATE_LIMIT: RateLimitOptions = {
  routeId: "auth.email.verify.request",
  identity: { max: 5, windowSeconds: 60 * 60 },
  ip: { max: 20, windowSeconds: 60 * 60 },
};

/**
 * 12.1.a's guardian consent routes — public, no session, and a token is the
 * only credential, so the IP dimension is what actually bounds a guesser.
 * Looser than password reset above: a real guardian legitimately re-opens
 * the same link (view, then approve, then — much later — revoke), and none
 * of the three sends mail on every call the way password reset does.
 */
export const GUARDIAN_CONSENT_VIEW_RATE_LIMIT: RateLimitOptions = {
  routeId: "guardian.consent.view",
  ip: { max: 30, windowSeconds: 15 * 60 },
  route: { max: 2000, windowSeconds: 15 * 60 },
};
export const GUARDIAN_CONSENT_APPROVE_RATE_LIMIT: RateLimitOptions = {
  routeId: "guardian.consent.approve",
  ip: { max: 10, windowSeconds: 15 * 60 },
  route: { max: 500, windowSeconds: 15 * 60 },
};
export const GUARDIAN_CONSENT_REVOKE_RATE_LIMIT: RateLimitOptions = {
  routeId: "guardian.consent.revoke",
  ip: { max: 10, windowSeconds: 15 * 60 },
  route: { max: 500, windowSeconds: 15 * 60 },
};
