import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS_CLIENT } from "../../../shared/redis/redis-client.module";

/**
 * Login lockout and throttling, in shared storage. YT-0540's third
 * criterion, and the ticket's own warning about it: *"this is the same
 * mistake as a per-process idempotency store — a counter each instance
 * keeps privately is not a limit."* `PostgresIdempotencyStore`'s header
 * makes the identical argument about a `Map`; this is Valkey instead of
 * Postgres because these counters are high-write and ephemeral — exactly
 * the profile the ticket calls out, and exactly why `docker-compose.yml`
 * runs Valkey with persistence off (`--save "" --appendonly no`). A restart
 * clearing every counter is an accepted, stated tradeoff, not a surprise —
 * the durable half of this feature (whether a credential exists at all,
 * whether a session is valid) lives in Postgres regardless.
 *
 * ## Two scopes, never combined
 *
 * `scope: "account"` and `scope: "source"` are tracked under separate keys,
 * checked and bumped independently, and a caller is blocked if EITHER is
 * over its limit. The account counter defends one user against a targeted
 * attacker; the source counter defends every account against one attacker
 * working through a list. Folding them into one counter would answer
 * neither question: an attacker rotating IPs would defeat a combined
 * counter as easily as a source-only one, and a combined counter shared
 * across every account at one IP would let a single busy office network
 * lock out everyone behind it after one person mistypes a password a few
 * times.
 *
 * ## Fixed window, not sliding
 *
 * `INCR` + `EXPIRE` on first increment is a fixed window: a caller who
 * fails at the very end of one window and again at the very start of the
 * next can fit close to `2 * maxAttempts` failures into a period close to
 * `windowSeconds`, not `windowSeconds * 2`. A sliding-window or token-bucket
 * limiter would close that gap; it is not built here because the fixed
 * window still bounds the worst case to a small constant multiple, and
 * `docs/09`'s velocity-limit prior art in this codebase already accepts the
 * same tradeoff for the same reason (two Valkey round trips instead of a
 * sorted-set-based sliding window). Recorded as a known, accepted
 * imprecision rather than a silent one.
 */
export type ThrottleScope = "account" | "source";

export interface ThrottleLimits {
  readonly maxAttempts: number;
  readonly windowSeconds: number;
}

export interface ThrottleVerdict {
  readonly blocked: boolean;
  /** Present only when blocked; how long until the window resets. */
  readonly retryAfterSeconds?: number;
}

const KEY_PREFIX = "yt:auth:throttle";

@Injectable()
export class ThrottleService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Read-only. Called BEFORE the expensive/sensitive work (an Argon2id
   * verify, a lockout-relevant decision) so a caller already over the
   * limit never reaches it — checking after the fact would still do the
   * work the limit exists to bound.
   */
  async peek(scope: ThrottleScope, key: string, limits: ThrottleLimits): Promise<ThrottleVerdict> {
    const redisKey = this.keyFor(scope, key);
    const [countRaw, ttl] = await Promise.all([this.redis.get(redisKey), this.redis.ttl(redisKey)]);
    const count = countRaw === null ? 0 : Number(countRaw);
    if (count >= limits.maxAttempts) {
      return { blocked: true, retryAfterSeconds: ttl > 0 ? ttl : limits.windowSeconds };
    }
    return { blocked: false };
  }

  /**
   * Called after a failed attempt, never after a successful one — a
   * counter that also counted successes would eventually lock out a user
   * who does nothing wrong.
   *
   * 1.5.f: this used to be `INCR` then, only on the first failure, a
   * separate `EXPIRE` — two round trips, and a crash (or a dropped
   * connection) between them left a key incremented but with no TTL,
   * which never expires: a permanent lockout from a single unlucky
   * failure at exactly the wrong moment. `SET key 1 EX windowSeconds NX`
   * creates the counter and its expiry as ONE atomic command — there is
   * no gap between them for anything to land in — and only the caller
   * that actually created the key (an "OK" reply) skips the `INCR` below;
   * every other caller's `NX` fails (the key already exists, with the TTL
   * its creator already gave it) and falls through to a plain `INCR`,
   * which needs no `EXPIRE` of its own because one is already running.
   */
  async recordFailure(scope: ThrottleScope, key: string, limits: ThrottleLimits): Promise<void> {
    const redisKey = this.keyFor(scope, key);
    const created = await this.redis.set(redisKey, "1", "EX", limits.windowSeconds, "NX");
    if (created !== null) return;
    await this.redis.incr(redisKey);
  }

  /**
   * Clears a counter after a legitimate success. Used for `scope:
   * "account"` only — see `login.use-case` — a genuine login must not stay
   * throttled because of earlier typos. Never called for `scope: "source"`:
   * resetting the broad-attack counter the moment ANY one account at that
   * source succeeds would let an attacker who eventually guesses one
   * password reset their budget for every account they have not yet tried.
   */
  async reset(scope: ThrottleScope, key: string): Promise<void> {
    await this.redis.del(this.keyFor(scope, key));
  }

  private keyFor(scope: ThrottleScope, key: string): string {
    return `${KEY_PREFIX}:${scope}:${key}`;
  }
}

/** 5 failures per 15 minutes, per account. */
export const ACCOUNT_THROTTLE_LIMITS: ThrottleLimits = { maxAttempts: 5, windowSeconds: 15 * 60 };

/**
 * 20 failures per 15 minutes, per source IP — looser than the account
 * limit on purpose. This defends every account against one attacker
 * working through a list, not one account against a targeted attacker
 * (that is the account limit's job), so it has to tolerate a shared office
 * or carrier-grade NAT IP producing more than five failures across many
 * different, legitimate people before it engages.
 */
export const SOURCE_THROTTLE_LIMITS: ThrottleLimits = { maxAttempts: 20, windowSeconds: 15 * 60 };
