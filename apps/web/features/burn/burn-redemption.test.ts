import { describe, expect, it } from "vitest";
import { toPoints } from "@yourtal/contracts/money";
import { hashStringToSeed } from "@yourtal/contracts/mock-seed";
import { attemptBurn } from "./burn-redemption";
import { computeLockExpiresAt } from "./price-lock";
import { makeBalanceFixture, makeListingFixture } from "./burn-test-fixtures";

const QUOTED_AT = new Date("2026-09-19T10:00:00.000Z");
const LOCK_EXPIRES_AT = computeLockExpiresAt(QUOTED_AT);

/** Finds a listing id whose simulated outcome bucket matches `wantFailure`, so tests target real behaviour instead of hardcoded magic ids. */
function findListingIdForOutcome(wantFailure: boolean): string {
  for (let index = 0; index < 200; index += 1) {
    const id = `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
    const isFailure = hashStringToSeed(`${id}:redemption-outcome`) % 8 === 0;
    if (isFailure === wantFailure) {
      return id;
    }
  }
  throw new Error(`could not find a demo listing id for wantFailure=${String(wantFailure)}`);
}

describe("attemptBurn", () => {
  it("refuses with lock_expired the instant nowMs reaches the lock's expiry, regardless of eligibility", () => {
    const listing = makeListingFixture({
      id: findListingIdForOutcome(false),
      priceInPoints: toPoints(100),
    });
    const balance = makeBalanceFixture({ availablePoints: toPoints(1_000_000) });

    const result = attemptBurn({
      listing,
      balance,
      lockExpiresAt: LOCK_EXPIRES_AT,
      nowMs: new Date(LOCK_EXPIRES_AT).getTime(),
    });

    expect(result).toEqual({
      ok: false,
      error: { type: "lock_expired", expiredAt: LOCK_EXPIRES_AT },
    });
  });

  it("refuses with the eligibility error when the lock is still valid but the wallet is short", () => {
    const listing = makeListingFixture({
      id: findListingIdForOutcome(false),
      priceInPoints: toPoints(5_000),
    });
    const balance = makeBalanceFixture({ availablePoints: toPoints(100) });

    const result = attemptBurn({
      listing,
      balance,
      lockExpiresAt: LOCK_EXPIRES_AT,
      nowMs: QUOTED_AT.getTime(),
    });

    expect(result).toEqual({ ok: false, error: { type: "insufficient_points", short: 4_900 } });
  });

  it("succeeds, with a voucher summary, for an eligible listing outside the simulated-failure bucket", () => {
    const listingId = findListingIdForOutcome(false);
    const listing = makeListingFixture({ id: listingId, priceInPoints: toPoints(1_000) });
    const balance = makeBalanceFixture({ availablePoints: toPoints(2_000) });

    const result = attemptBurn({
      listing,
      balance,
      lockExpiresAt: LOCK_EXPIRES_AT,
      nowMs: QUOTED_AT.getTime(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.voucher.merchantName).toBe(listing.merchantName);
      expect(result.voucher.title).toBe(listing.title);
      expect(result.voucher.faceValueMinor).toBe(listing.faceValueMinor);
      expect(result.voucher.code.length).toBeGreaterThan(0);
    }
  });

  it("returns redemption_failed, not a thrown exception, for a listing in the simulated-failure bucket", () => {
    const listingId = findListingIdForOutcome(true);
    const listing = makeListingFixture({ id: listingId, priceInPoints: toPoints(1_000) });
    const balance = makeBalanceFixture({ availablePoints: toPoints(2_000) });

    const result = attemptBurn({
      listing,
      balance,
      lockExpiresAt: LOCK_EXPIRES_AT,
      nowMs: QUOTED_AT.getTime(),
    });

    expect(result).toEqual({ ok: false, error: { type: "redemption_failed" } });
  });

  it("is deterministic: the same input always produces the same outcome", () => {
    const listing = makeListingFixture({
      id: findListingIdForOutcome(false),
      priceInPoints: toPoints(1_000),
    });
    const balance = makeBalanceFixture({ availablePoints: toPoints(2_000) });
    const input = { listing, balance, lockExpiresAt: LOCK_EXPIRES_AT, nowMs: QUOTED_AT.getTime() };

    const first = attemptBurn(input);
    const second = attemptBurn(input);
    expect(first.ok).toBe(second.ok);
  });
});
