import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { ThrottleService } from "./throttle.service";
import type { ThrottleLimits } from "./throttle.service";

/**
 * `ThrottleService`, against the real Valkey this app runs against
 * everywhere else (`env.schema.test.ts`'s own default for `REDIS_URL`) —
 * 1.5.f's own bar: prove the atomic `recordFailure` holds under real
 * concurrency, not just read the code and agree it looks right.
 */
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://127.0.0.1:26379";

const redis = new Redis(REDIS_URL);
const throttle = new ThrottleService(redis);

afterAll(() => {
  redis.disconnect();
});

function freshKey(): string {
  return `throttle-test-${randomUUID()}`;
}

const LIMITS: ThrottleLimits = { maxAttempts: 20, windowSeconds: 900 };

describe("recordFailure is atomic under real concurrency (1.5.f)", () => {
  it("N concurrent failures on a brand-new key produce a count of exactly N, with a TTL from the first command onward", async () => {
    const key = freshKey();
    const concurrency = 20;

    // Every caller races to create the SAME key. Exactly one's `SET ... NX`
    // succeeds; the rest fall through to `INCR`. If the old two-step
    // INCR-then-EXPIRE shape's race were still here, this is exactly the
    // scenario that could produce a lost EXPIRE (or, under the right
    // interleaving, a key that briefly has no TTL at all) — the composite
    // SET-NX-EX-or-INCR shape has no such window, because the ONLY place a
    // TTL is ever set is inside the single atomic command that also creates
    // the key.
    await Promise.all(
      Array.from({ length: concurrency }, () => throttle.recordFailure("source", key, LIMITS)),
    );

    const redisKey = `yt:auth:throttle:source:${key}`;
    const [count, ttl] = await Promise.all([redis.get(redisKey), redis.ttl(redisKey)]);
    expect(Number(count)).toBe(concurrency);
    // > 0, not just "not -1": a TTL of exactly 0 would mean the key is
    // about to vanish, which is as wrong here as never having one.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LIMITS.windowSeconds);
  });

  it("a key created by one call always carries a TTL — never a bare counter", async () => {
    const key = freshKey();
    await throttle.recordFailure("account", key, LIMITS);
    const ttl = await redis.ttl(`yt:auth:throttle:account:${key}`);
    expect(ttl).toBeGreaterThan(0);
  });

  it("still blocks once maxAttempts is reached, exactly as peek did before this change", async () => {
    const key = freshKey();
    for (let i = 0; i < LIMITS.maxAttempts; i += 1) {
      await throttle.recordFailure("source", key, LIMITS);
    }
    const verdict = await throttle.peek("source", key, LIMITS);
    expect(verdict.blocked).toBe(true);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
  });
});
