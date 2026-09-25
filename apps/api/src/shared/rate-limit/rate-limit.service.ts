import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS_CLIENT } from "../redis/redis-client.module";

/**
 * Per-route request limiting on the shared Valkey instance. YT-0052's
 * second criterion: *"per-route, per-identity and per-IP limits with a
 * shared Redis backend."*
 *
 * ## Why this is not `ThrottleService`
 *
 * `modules/auth/throttle/throttle.service.ts` already counts per-account
 * and per-source on the same Valkey, and the overlap is real enough to be
 * worth stating rather than leaving for a reviewer to notice. They are
 * kept separate because they count different events and that difference is
 * load-bearing, not stylistic:
 *
 * - `ThrottleService` is **lockout** semantics. It increments only on a
 *   FAILED attempt (`recordFailure`) and clears the account counter on
 *   success (`reset`). A user who logs in correctly a hundred times is
 *   never throttled, which is the whole point — that counter measures
 *   evidence of guessing.
 * - This service is **rate** semantics. It counts EVERY request to a route
 *   regardless of outcome, because the cost being bounded is the request
 *   itself. `password/reset/request` is the case that makes this concrete:
 *   every call succeeds, and every call sends an email. A failure-counted
 *   limiter bounds nothing at all there, because there are no failures.
 *
 * Folding them together would force one of the two to adopt the other's
 * event definition, and either direction breaks something: rate-counting
 * login would lock out a busy legitimate user, and failure-counting a
 * password-reset route would leave a mail bomb completely unlimited.
 *
 * ## Three dimensions, checked independently, blocked on any
 *
 * A request is refused if it is over the limit on ANY configured
 * dimension, and each dimension gets its own key and its own counter:
 *
 * - `route` — every caller of this route, combined. Bounds total cost of
 *   an endpoint (the outbound mail, the Argon2id verifies) no matter how
 *   the load is distributed across identities or addresses.
 * - `identity` — one authenticated principal. Bounds an authenticated
 *   abuser who is not hiding.
 * - `ip` — one source address. Bounds an anonymous caller, which is the
 *   only dimension available before a principal exists at all.
 *
 * Combining them into one key would answer none of the three questions:
 * a single counter keyed by route+identity+ip lets an attacker rotating
 * addresses defeat it exactly as easily as an ip-only counter, while a
 * shared office NAT would share a budget with an unrelated user.
 *
 * ## Fixed window, and the same accepted imprecision as ThrottleService
 *
 * `INCR` plus `EXPIRE` on first increment. A caller who spends its budget
 * at the very end of one window and again at the start of the next fits
 * close to `2 * max` requests into a period close to `windowSeconds`. That
 * is a bounded constant multiple, it is the tradeoff `ThrottleService`
 * already documents and accepts for the same reason (two round trips
 * instead of a sorted-set sliding window), and it is recorded here rather
 * than discovered later.
 *
 * ## Failure mode is deliberate and is NOT fail-open
 *
 * If Valkey is unreachable, `ioredis` rejects after `maxRetriesPerRequest`
 * and this service lets that error propagate. The guard turns it into a
 * 503. That is a choice: a rate limiter that fails open is a rate limiter
 * that disappears exactly when the system is already under stress, which
 * is when the limits matter most. `RedisClientModule` sets
 * `maxRetriesPerRequest: 3` for the related reason — a hanging check would
 * be worse than an erroring one.
 */

/** The dimension a limit is counted along. See the class doc. */
export type RateLimitDimension = "route" | "identity" | "ip";

export interface RateLimitWindow {
  readonly max: number;
  readonly windowSeconds: number;
}

/**
 * A route's limits. Every dimension is optional; a route declares only the
 * ones that mean something for it. An anonymous route has no `identity`
 * to key on, and saying so explicitly is better than a zero that reads
 * like "no requests allowed".
 */
export interface RateLimitPolicy {
  readonly route?: RateLimitWindow;
  readonly identity?: RateLimitWindow;
  readonly ip?: RateLimitWindow;
}

export interface RateLimitVerdict {
  readonly blocked: boolean;
  /** Which dimension refused it. Present only when blocked. */
  readonly dimension?: RateLimitDimension;
  /** Seconds until that dimension's window resets. Present only when blocked. */
  readonly retryAfterSeconds?: number;
}

export interface RateLimitSubject {
  /** Route identifier — the metadata key, not the URL, so a path parameter cannot split a counter. */
  readonly routeId: string;
  /** Authenticated principal id, when there is one. */
  readonly identityId?: string;
  /** Source address. */
  readonly ip: string;
}

const KEY_PREFIX = "yt:ratelimit";

@Injectable()
export class RateLimitService {
  private readonly prefix: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    namespace = "",
  ) {
    this.prefix = namespace === "" ? KEY_PREFIX : `${KEY_PREFIX}:${namespace}`;
  }

  /**
   * Counts this request against every configured dimension and returns the
   * verdict.
   *
   * ## Why it counts before it decides
   *
   * Every dimension is incremented even when an earlier one has already
   * refused. That looks wasteful and is deliberate: a caller who is over
   * the route limit is still making requests from an address, and not
   * counting them would let a flood arrive under the route limit while the
   * per-IP counter reads zero — so the moment the route window rolled over,
   * the IP would have a full budget it had in fact just spent. The counters
   * have to describe what happened, not what was served.
   *
   * ## Why the refusal reports the FIRST dimension in a fixed order
   *
   * `route` before `identity` before `ip`. A caller who is over on several
   * gets one answer and always the same one, so a client cannot probe which
   * dimensions exist by watching the reason change. `retryAfterSeconds`
   * comes from that dimension only.
   */
  async consume(subject: RateLimitSubject, policy: RateLimitPolicy): Promise<RateLimitVerdict> {
    const checks: Array<{ dimension: RateLimitDimension; key: string; window: RateLimitWindow }> =
      [];

    if (policy.route) {
      checks.push({
        dimension: "route",
        key: this.keyFor("route", subject.routeId, "all"),
        window: policy.route,
      });
    }
    // An unauthenticated caller has no identity to count, so the identity
    // dimension simply does not apply to that request. It is skipped rather
    // than keyed on a placeholder such as "anonymous": every anonymous
    // caller in the system would otherwise share one counter, and the first
    // few would spend the budget for all of them.
    if (policy.identity && subject.identityId !== undefined) {
      checks.push({
        dimension: "identity",
        key: this.keyFor("identity", subject.routeId, subject.identityId),
        window: policy.identity,
      });
    }
    if (policy.ip) {
      checks.push({
        dimension: "ip",
        key: this.keyFor("ip", subject.routeId, subject.ip),
        window: policy.ip,
      });
    }

    const results = await Promise.all(
      checks.map(async (check) => ({
        ...check,
        count: await this.increment(check.key, check.window.windowSeconds),
      })),
    );

    for (const result of results) {
      if (result.count > result.window.max) {
        const ttl = await this.redis.ttl(result.key);
        return {
          blocked: true,
          dimension: result.dimension,
          retryAfterSeconds: ttl > 0 ? ttl : result.window.windowSeconds,
        };
      }
    }

    return { blocked: false };
  }

  /**
   * `INCR` creates the key at 1 atomically; the `EXPIRE` that follows is
   * why the first request of a window is the one that sets how long the
   * window lasts. Two round trips rather than one `SET ... EX` because
   * `INCR` has to run first to know whether this was the first request —
   * the same shape, and the same reason, as `ThrottleService.recordFailure`.
   */
  private async increment(key: string, windowSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSeconds);
    }
    return count;
  }

  private keyFor(dimension: RateLimitDimension, routeId: string, subject: string): string {
    return `${this.prefix}:${dimension}:${routeId}:${subject}`;
  }
}
