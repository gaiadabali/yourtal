import { describe, expect, it } from "vitest";
import { toPoints } from "@yourtal/contracts/money";
import { burnErrorFromApiError, classifyBalanceEligibility, recoveryForError } from "./burn-errors";
import { makeBalanceFixture as makeBalance } from "./burn-test-fixtures";

describe("classifyBalanceEligibility", () => {
  it("is eligible (null) when available points alone cover the price", () => {
    const balance = makeBalance({ availablePoints: toPoints(5_000) });
    expect(classifyBalanceEligibility(5_000, balance)).toBeNull();
  });

  it("reports insufficient_points with the exact shortfall when even pending points would not cover it", () => {
    const balance = makeBalance({
      availablePoints: toPoints(1_000),
      pendingPoints: toPoints(500),
      pendingUnlockAt: "2026-09-22T00:00:00.000Z",
    });
    expect(classifyBalanceEligibility(5_000, balance)).toEqual({
      type: "insufficient_points",
      short: 3_500,
    });
  });

  it("reports holdback_blocks (not insufficient_points) when pending points would cover the gap", () => {
    // Mirrors the old mixedStateBalanceFixture's shape: 8,400 available + 1,200 pending.
    const balance = makeBalance({
      availablePoints: toPoints(8_400),
      pendingPoints: toPoints(1_200),
      pendingUnlockAt: "2026-09-22T00:00:00.000Z",
    });
    expect(classifyBalanceEligibility(9_000, balance)).toEqual({
      type: "holdback_blocks",
      unlocksAt: "2026-09-22T00:00:00.000Z",
    });
  });

  it("treats the boundary (available + pending exactly equal to price) as eligible via holdback, not insufficient", () => {
    const balance = makeBalance({
      availablePoints: toPoints(8_400),
      pendingPoints: toPoints(1_200),
      pendingUnlockAt: "2026-09-22T00:00:00.000Z",
    });
    expect(classifyBalanceEligibility(9_600, balance)).toEqual({
      type: "holdback_blocks",
      unlocksAt: "2026-09-22T00:00:00.000Z",
    });
  });
});

describe("burnErrorFromApiError", () => {
  const LOCK_EXPIRES_AT = "2026-09-19T10:10:00.000Z";

  it("folds a server-side quote_expired refusal into the same lock_expired shape the countdown produces", () => {
    expect(
      burnErrorFromApiError(
        { kind: "http", status: 409, code: "quote_expired", message: "the quote has expired" },
        LOCK_EXPIRES_AT,
      ),
    ).toEqual({ type: "lock_expired", expiredAt: LOCK_EXPIRES_AT });
  });

  it("maps insufficient_available to insufficient_now, with no stale shortfall number", () => {
    expect(
      burnErrorFromApiError(
        {
          kind: "http",
          status: 409,
          code: "insufficient_available",
          message: "not enough points to spend",
        },
        LOCK_EXPIRES_AT,
      ),
    ).toEqual({ type: "insufficient_now" });
  });

  it("maps allocation_exhausted and listing_unavailable to checkout_unavailable", () => {
    for (const code of ["allocation_exhausted", "listing_unavailable"]) {
      expect(
        burnErrorFromApiError(
          { kind: "http", status: 409, code, message: "sold out" },
          LOCK_EXPIRES_AT,
        ),
      ).toEqual({ type: "checkout_unavailable" });
    }
  });

  it("maps every other 1.2.c code to checkout_blocked", () => {
    const blockedCodes = [
      "region_mismatch",
      "audience_blocked",
      "campaign_cap_reached",
      "velocity_capped",
      "solvency_blocked",
      "already_granted",
      "idempotency_conflict",
      "kill_switch",
      "currency_mismatch",
      "dispute_window_open",
      "statement_not_open",
    ];
    for (const code of blockedCodes) {
      expect(
        burnErrorFromApiError(
          { kind: "http", status: 409, code, message: "blocked" },
          LOCK_EXPIRES_AT,
        ),
      ).toEqual({ type: "checkout_blocked" });
    }
  });

  it("maps an unrecognised http code, a network failure and an invalid response all to checkout_failed", () => {
    expect(
      burnErrorFromApiError(
        { kind: "http", status: 500, code: "http_500", message: "internal error" },
        LOCK_EXPIRES_AT,
      ),
    ).toEqual({ type: "checkout_failed" });
    expect(burnErrorFromApiError({ kind: "network", message: "offline" }, LOCK_EXPIRES_AT)).toEqual(
      { type: "checkout_failed" },
    );
    expect(
      burnErrorFromApiError(
        { kind: "invalid_response", message: "did not match its contract" },
        LOCK_EXPIRES_AT,
      ),
    ).toEqual({ type: "checkout_failed" });
  });
});

describe("recoveryForError", () => {
  it("offers a retry only for a generic checkout failure", () => {
    expect(recoveryForError({ type: "checkout_failed" })).toEqual({ kind: "retry" });
  });

  it("offers a re-quote only for an expired lock", () => {
    expect(
      recoveryForError({ type: "lock_expired", expiredAt: "2026-09-19T10:10:00.000Z" }),
    ).toEqual({ kind: "requote" });
  });

  it("sends every wallet/listing-fact failure back to the store, since retrying changes nothing", () => {
    expect(recoveryForError({ type: "insufficient_points", short: 100 })).toEqual({
      kind: "back_to_store",
    });
    expect(recoveryForError({ type: "insufficient_now" })).toEqual({ kind: "back_to_store" });
    expect(
      recoveryForError({ type: "holdback_blocks", unlocksAt: "2026-09-22T00:00:00.000Z" }),
    ).toEqual({ kind: "back_to_store" });
    expect(recoveryForError({ type: "checkout_unavailable" })).toEqual({ kind: "back_to_store" });
    expect(recoveryForError({ type: "checkout_blocked" })).toEqual({ kind: "back_to_store" });
  });
});
