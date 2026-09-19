import { describe, expect, it } from "vitest";
import { toPoints } from "@yourtal/contracts/money";
import { classifyBurnEligibility, recoveryForError } from "./burn-errors";
import { makeBalanceFixture as makeBalance, makeListingFixture as makeListing } from "./burn-test-fixtures";

describe("classifyBurnEligibility", () => {
  it("is eligible (null) when available points alone cover the price", () => {
    const listing = makeListing({ priceInPoints: toPoints(5_000) });
    const balance = makeBalance({ availablePoints: toPoints(5_000) });
    expect(classifyBurnEligibility(listing, balance)).toBeNull();
  });

  it("blocks with listing_unavailable when stock is exhausted, before even looking at the balance", () => {
    const listing = makeListing({ priceInPoints: toPoints(1), stockRemaining: 0, status: "sold_out" });
    const balance = makeBalance({ availablePoints: toPoints(1_000_000) });
    expect(classifyBurnEligibility(listing, balance)).toEqual({ type: "listing_unavailable", status: "sold_out" });
  });

  it("reports insufficient_points with the exact shortfall when even pending points would not cover it", () => {
    const listing = makeListing({ priceInPoints: toPoints(5_000) });
    const balance = makeBalance({ availablePoints: toPoints(1_000), pendingPoints: toPoints(500), pendingUnlockAt: "2026-09-22T00:00:00.000Z" });
    expect(classifyBurnEligibility(listing, balance)).toEqual({ type: "insufficient_points", short: 3_500 });
  });

  it("reports holdback_blocks (not insufficient_points) when pending points would cover the gap", () => {
    const listing = makeListing({ priceInPoints: toPoints(9_000) });
    // Mirrors mixedStateBalanceFixture's shape: 8,400 available + 1,200 pending.
    const balance = makeBalance({
      availablePoints: toPoints(8_400),
      pendingPoints: toPoints(1_200),
      pendingUnlockAt: "2026-09-22T00:00:00.000Z",
    });
    expect(classifyBurnEligibility(listing, balance)).toEqual({ type: "holdback_blocks", unlocksAt: "2026-09-22T00:00:00.000Z" });
  });

  it("treats the boundary (available + pending exactly equal to price) as eligible via holdback, not insufficient", () => {
    const listing = makeListing({ priceInPoints: toPoints(9_600) });
    const balance = makeBalance({ availablePoints: toPoints(8_400), pendingPoints: toPoints(1_200), pendingUnlockAt: "2026-09-22T00:00:00.000Z" });
    expect(classifyBurnEligibility(listing, balance)).toEqual({ type: "holdback_blocks", unlocksAt: "2026-09-22T00:00:00.000Z" });
  });
});

describe("recoveryForError", () => {
  it("offers a retry only for a transient redemption failure", () => {
    expect(recoveryForError({ type: "redemption_failed" })).toEqual({ kind: "retry" });
  });

  it("offers a re-quote only for an expired lock", () => {
    expect(recoveryForError({ type: "lock_expired", expiredAt: "2026-09-19T10:10:00.000Z" })).toEqual({ kind: "requote" });
  });

  it("sends every wallet/listing-fact failure back to the store, since retrying changes nothing", () => {
    expect(recoveryForError({ type: "insufficient_points", short: 100 })).toEqual({ kind: "back_to_store" });
    expect(recoveryForError({ type: "holdback_blocks", unlocksAt: "2026-09-22T00:00:00.000Z" })).toEqual({ kind: "back_to_store" });
    expect(recoveryForError({ type: "listing_unavailable", status: "sold_out" })).toEqual({ kind: "back_to_store" });
  });
});
