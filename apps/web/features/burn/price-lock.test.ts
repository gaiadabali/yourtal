import { describe, expect, it } from "vitest";
import { PRICE_LOCK_DURATION_MS, computeLockExpiresAt, isLockExpired, millisecondsUntilLock } from "./price-lock";

const QUOTED_AT = new Date("2026-09-19T10:00:00.000Z");

describe("computeLockExpiresAt", () => {
  it("adds exactly the lock duration to the quoted instant", () => {
    const expiresAt = computeLockExpiresAt(QUOTED_AT);
    expect(new Date(expiresAt).getTime() - QUOTED_AT.getTime()).toBe(PRICE_LOCK_DURATION_MS);
  });
});

describe("millisecondsUntilLock", () => {
  it("returns the gap when the lock has not yet expired", () => {
    const lockExpiresAt = computeLockExpiresAt(QUOTED_AT);
    const remaining = millisecondsUntilLock(lockExpiresAt, QUOTED_AT.getTime() + 60_000);
    expect(remaining).toBe(PRICE_LOCK_DURATION_MS - 60_000);
  });

  it("floors at 0 once the instant is past expiry, never negative", () => {
    const lockExpiresAt = computeLockExpiresAt(QUOTED_AT);
    const remaining = millisecondsUntilLock(lockExpiresAt, QUOTED_AT.getTime() + PRICE_LOCK_DURATION_MS + 5_000);
    expect(remaining).toBe(0);
  });
});

describe("isLockExpired", () => {
  const lockExpiresAt = computeLockExpiresAt(QUOTED_AT);

  it("is false one millisecond before expiry", () => {
    expect(isLockExpired(lockExpiresAt, new Date(lockExpiresAt).getTime() - 1)).toBe(false);
  });

  it("is true exactly at the expiry instant (>= — an exact-tick race must still refuse)", () => {
    expect(isLockExpired(lockExpiresAt, new Date(lockExpiresAt).getTime())).toBe(true);
  });

  it("is true well after expiry", () => {
    expect(isLockExpired(lockExpiresAt, new Date(lockExpiresAt).getTime() + 999_999)).toBe(true);
  });
});
