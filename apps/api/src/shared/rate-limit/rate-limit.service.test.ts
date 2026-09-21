import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { RateLimitService, type RateLimitPolicy } from "./rate-limit.service";

/**
 * `RateLimitService` against the REAL Valkey this app uses everywhere else
 * (`REDIS_URL`), not a fake — the same choice `auth.service.test.ts` makes
 * and for the same reason: the behaviour under test IS the Redis semantics
 * (`INCR` creating at 1, `EXPIRE` on first increment only, `TTL` on a key
 * that exists). A fake would be asserting my own model of Redis back to me,
 * which is exactly the part that could be wrong.
 *
 * Every test takes a fresh `routeId` from `randomUUID()`. That is not
 * decoration: `auth.service.test.ts` records finding, by running the suite
 * rather than by reasoning about it, that a small keyspace collides
 * constantly across call sites and silently merges two tests' counters into
 * one bucket. A UUID per test makes that impossible instead of unlikely.
 */
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://127.0.0.1:26379";

const redis = new Redis(REDIS_URL);
const rateLimit = new RateLimitService(redis);

function freshRoute(): string {
  return `test-route-${randomUUID()}`;
}

function freshIp(): string {
  return `test-source-${randomUUID()}`;
}

afterAll(async () => {
  await redis.quit();
});

describe("RateLimitService", () => {
  it("allows requests up to the limit and refuses the one after it", async () => {
    const policy: RateLimitPolicy = { ip: { max: 3, windowSeconds: 60 } };
    const subject = { routeId: freshRoute(), ip: freshIp() };

    const first = await rateLimit.consume(subject, policy);
    const second = await rateLimit.consume(subject, policy);
    const third = await rateLimit.consume(subject, policy);
    const fourth = await rateLimit.consume(subject, policy);

    expect([first.blocked, second.blocked, third.blocked]).toEqual([false, false, false]);
    expect(fourth.blocked).toBe(true);
    expect(fourth.dimension).toBe("ip");
  });

  it("reports a retry-after taken from the window, not a constant", async () => {
    const policy: RateLimitPolicy = { ip: { max: 1, windowSeconds: 120 } };
    const subject = { routeId: freshRoute(), ip: freshIp() };

    await rateLimit.consume(subject, policy);
    const blocked = await rateLimit.consume(subject, policy);

    expect(blocked.blocked).toBe(true);
    // Read from the live TTL, so it is at most the window and close to it.
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(120);
  });

  /**
   * The property that makes three dimensions worth having. If these shared
   * a counter, the second IP would arrive already spent.
   */
  it("keeps dimensions in separate counters — one IP exhausting its budget does not block another", async () => {
    const policy: RateLimitPolicy = { ip: { max: 2, windowSeconds: 60 } };
    const routeId = freshRoute();
    const noisy = { routeId, ip: freshIp() };
    const innocent = { routeId, ip: freshIp() };

    await rateLimit.consume(noisy, policy);
    await rateLimit.consume(noisy, policy);
    const noisyBlocked = await rateLimit.consume(noisy, policy);
    const innocentAllowed = await rateLimit.consume(innocent, policy);

    expect(noisyBlocked.blocked).toBe(true);
    expect(innocentAllowed.blocked).toBe(false);
  });

  /**
   * The converse, and the reason a `route` dimension exists at all: an
   * attacker distributing across addresses defeats a per-IP limit entirely,
   * and only the route counter sees the aggregate.
   */
  it("refuses on the route dimension even when every caller is under its own IP limit", async () => {
    const policy: RateLimitPolicy = {
      route: { max: 3, windowSeconds: 60 },
      ip: { max: 100, windowSeconds: 60 },
    };
    const routeId = freshRoute();

    const verdicts = [];
    for (let i = 0; i < 4; i += 1) {
      // A different address every time — no per-IP counter ever reaches 2.
      verdicts.push(await rateLimit.consume({ routeId, ip: freshIp() }, policy));
    }

    expect(verdicts.slice(0, 3).map((v) => v.blocked)).toEqual([false, false, false]);
    expect(verdicts[3]?.blocked).toBe(true);
    expect(verdicts[3]?.dimension).toBe("route");
  });

  /**
   * Anonymous callers must not share an `identity` bucket. If the service
   * keyed a missing identity on a placeholder, the second anonymous caller
   * here would be refused on a budget the first one spent.
   */
  it("skips the identity dimension entirely when there is no principal", async () => {
    const policy: RateLimitPolicy = { identity: { max: 1, windowSeconds: 60 } };
    const routeId = freshRoute();

    const first = await rateLimit.consume({ routeId, ip: freshIp() }, policy);
    const second = await rateLimit.consume({ routeId, ip: freshIp() }, policy);

    expect(first.blocked).toBe(false);
    expect(second.blocked).toBe(false);
  });

  it("counts identities separately from each other", async () => {
    const policy: RateLimitPolicy = { identity: { max: 1, windowSeconds: 60 } };
    const routeId = freshRoute();
    const ip = freshIp();
    const alice = randomUUID();
    const bob = randomUUID();

    await rateLimit.consume({ routeId, ip, identityId: alice }, policy);
    const aliceSecond = await rateLimit.consume({ routeId, ip, identityId: alice }, policy);
    const bobFirst = await rateLimit.consume({ routeId, ip, identityId: bob }, policy);

    expect(aliceSecond.blocked).toBe(true);
    expect(aliceSecond.dimension).toBe("identity");
    expect(bobFirst.blocked).toBe(false);
  });

  /**
   * Counting continues past a refusal. Without this, a caller flooding past
   * the route limit would leave its per-IP counter reading near zero, and
   * would get a full IP budget the instant the route window rolled over —
   * a budget it had in fact just spent.
   */
  it("still counts every dimension on a request an earlier dimension refused", async () => {
    const policy: RateLimitPolicy = {
      route: { max: 1, windowSeconds: 60 },
      ip: { max: 10, windowSeconds: 60 },
    };
    const routeId = freshRoute();
    const ip = freshIp();

    await rateLimit.consume({ routeId, ip }, policy);
    const refused = await rateLimit.consume({ routeId, ip }, policy);
    expect(refused.blocked).toBe(true);
    expect(refused.dimension).toBe("route");

    // The refused request was still counted against the IP: 2, not 1.
    const ipCount = await redis.get(`yt:ratelimit:ip:${routeId}:${ip}`);
    expect(ipCount).toBe("2");
  });

  /**
   * Fixed-window boundary, stated as a test rather than only as a comment,
   * so the accepted imprecision is visible to whoever tightens it later.
   * The window expiring resets the budget in full.
   */
  it("resets the budget when the window expires", async () => {
    const policy: RateLimitPolicy = { ip: { max: 1, windowSeconds: 1 } };
    const subject = { routeId: freshRoute(), ip: freshIp() };

    await rateLimit.consume(subject, policy);
    expect((await rateLimit.consume(subject, policy)).blocked).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect((await rateLimit.consume(subject, policy)).blocked).toBe(false);
  });

  /**
   * The first request sets the window; later ones must not extend it.
   * A limiter that re-expired on every request would never release a caller
   * who keeps knocking — the window would slide forward indefinitely and a
   * blocked caller could never come back, which is a lockout, not a limit.
   */
  it("sets the window on the first request only and does not extend it", async () => {
    const policy: RateLimitPolicy = { ip: { max: 10, windowSeconds: 60 } };
    const subject = { routeId: freshRoute(), ip: freshIp() };

    await rateLimit.consume(subject, policy);
    const ttlAfterFirst = await redis.ttl(`yt:ratelimit:ip:${subject.routeId}:${subject.ip}`);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    await rateLimit.consume(subject, policy);
    const ttlAfterSecond = await redis.ttl(`yt:ratelimit:ip:${subject.routeId}:${subject.ip}`);

    expect(ttlAfterSecond).toBeLessThan(ttlAfterFirst);
  });
});
