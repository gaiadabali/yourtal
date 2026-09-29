import { describe, expect, it } from "vitest";
import { isLockExpired, millisecondsUntilLock } from "./price-lock";

const QUOTED_AT = new Date("2026-09-19T10:00:00.000Z");
const LOCK_EXPIRES_AT = new Date(QUOTED_AT.getTime() + 15 * 60 * 1000).toISOString();

describe("millisecondsUntilLock", () => {
  it("returns the gap when the lock has not yet expired", () => {
    const remaining = millisecondsUntilLock(LOCK_EXPIRES_AT, QUOTED_AT.getTime() + 60_000);
    expect(remaining).toBe(15 * 60 * 1000 - 60_000);
  });

  it("floors at 0 once the instant is past expiry, never negative", () => {
    const remaining = millisecondsUntilLock(
      LOCK_EXPIRES_AT,
      QUOTED_AT.getTime() + 15 * 60 * 1000 + 5_000,
    );
    expect(remaining).toBe(0);
  });
});

describe("isLockExpired", () => {
  it("is false one millisecond before expiry", () => {
    expect(isLockExpired(LOCK_EXPIRES_AT, new Date(LOCK_EXPIRES_AT).getTime() - 1)).toBe(false);
  });

  it("is true exactly at the expiry instant (>= — an exact-tick race must still refuse)", () => {
    expect(isLockExpired(LOCK_EXPIRES_AT, new Date(LOCK_EXPIRES_AT).getTime())).toBe(true);
  });

  it("is true well after expiry", () => {
    expect(isLockExpired(LOCK_EXPIRES_AT, new Date(LOCK_EXPIRES_AT).getTime() + 999_999)).toBe(
      true,
    );
  });
});
