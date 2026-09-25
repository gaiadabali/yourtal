import { describe, expect, it } from "vitest";
import type { Voucher } from "@yourtal/contracts/voucher";
import { attemptRedemption, generateIdempotencyKey } from "./merchant-redemption";
import { rupiah } from "@yourtal/contracts/money";

const NOW_MS = Date.parse("2026-09-19T09:00:00.000Z");

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: "voucher-1",
    listingId: "listing-1",
    ownerId: "owner-1",
    code: "ABC12345",
    merchantId: "00000000-0000-4000-8000-000000000601",
    merchantName: "Toko Berkah",
    currency: "IDR",
    minimumSpendMinor: null,
    title: "Voucher Toko Berkah",
    faceValueMinor: rupiah(50_000),
    remainingValueMinor: rupiah(50_000),
    partialRedemptionPolicy: "balance_carrying",
    transferable: false,
    status: "active",
    issuedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  } as Voucher;
}

describe("attemptRedemption", () => {
  it("re-runs eligibility from scratch and refuses exactly like classifyRedemptionEligibility would", () => {
    const voucher = makeVoucher({ status: "redeemed" });
    const result = attemptRedemption({
      voucher,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: 10_000,
      effectiveRemainingMinor: 50_000,
      nowMs: NOW_MS,
      idempotencyKey: "any-key",
    });
    expect(result).toEqual({ ok: false, error: { type: "already_redeemed" } });
  });

  it("never claims success for an ineligible attempt regardless of the idempotency key", () => {
    const voucher = makeVoucher({ expiresAt: "2026-09-01T00:00:00.000Z" });
    for (let index = 0; index < 20; index += 1) {
      const result = attemptRedemption({
        voucher,
        deviceMerchantId: "00000000-0000-4000-8000-000000000601",
        deviceMerchantName: "Toko Berkah",
        amountMinor: 10_000,
        effectiveRemainingMinor: 50_000,
        nowMs: NOW_MS,
        idempotencyKey: `key-${index}`,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("produces a receipt with the amount captured and the correctly reduced remaining value on success", () => {
    const voucher = makeVoucher();
    // Search a small set of keys for one that lands outside the simulated
    // failure bucket, deterministically (never Math.random in the search).
    let successResult: ReturnType<typeof attemptRedemption> | null = null;
    for (let index = 0; index < 50 && !successResult?.ok; index += 1) {
      const key = `probe-${index}`;
      const attempt = attemptRedemption({
        voucher,
        deviceMerchantId: "00000000-0000-4000-8000-000000000601",
        deviceMerchantName: "Toko Berkah",
        amountMinor: 20_000,
        effectiveRemainingMinor: 50_000,
        nowMs: NOW_MS,
        idempotencyKey: key,
      });
      if (attempt.ok) {
        successResult = attempt;
      }
    }
    expect(successResult?.ok).toBe(true);
    if (successResult?.ok) {
      expect(successResult.receipt.amountCapturedMinor).toBe(20_000);
      expect(successResult.receipt.remainingValueMinor).toBe(30_000);
      expect(successResult.receipt.voucherId).toBe(voucher.id);
    }
  });

  it("is deterministic — the same idempotency key always produces the same outcome", () => {
    const voucher = makeVoucher();
    const input = {
      voucher,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: 10_000,
      effectiveRemainingMinor: 50_000,
      nowMs: NOW_MS,
      idempotencyKey: "fixed-key-123",
    };
    expect(attemptRedemption(input)).toEqual(attemptRedemption(input));
  });
});

describe("generateIdempotencyKey", () => {
  it("is deterministic for the same voucher and instant", () => {
    expect(generateIdempotencyKey("voucher-1", NOW_MS)).toBe(
      generateIdempotencyKey("voucher-1", NOW_MS),
    );
  });

  it("differs across vouchers or instants", () => {
    expect(generateIdempotencyKey("voucher-1", NOW_MS)).not.toBe(
      generateIdempotencyKey("voucher-2", NOW_MS),
    );
    expect(generateIdempotencyKey("voucher-1", NOW_MS)).not.toBe(
      generateIdempotencyKey("voucher-1", NOW_MS + 1),
    );
  });
});

describe("simulated network failure is transient", () => {
  // Finding a key in the failing bucket rather than inventing one: the
  // simulation is deterministic, so the bucket is discoverable.
  function keyInFailingBucket(): string {
    for (let i = 0; i < 5_000; i += 1) {
      const key = generateIdempotencyKey("00000000-0000-4000-8000-0000000009aa", i);
      const failed = attemptRedemption({
        voucher: makeVoucher(),
        deviceMerchantId: "00000000-0000-4000-8000-000000000601",
        deviceMerchantName: "Toko Berkah",
        amountMinor: 10_000,
        effectiveRemainingMinor: 50_000,
        nowMs: NOW_MS,
        idempotencyKey: key,
        attempt: 1,
      });
      if (!failed.ok && failed.error.type === "network_error") {
        return key;
      }
    }
    throw new Error("no idempotency key landed in the simulated-failure bucket");
  }

  it("clears on retry with the SAME idempotency key", () => {
    const key = keyInFailingBucket();
    const base = {
      voucher: makeVoucher(),
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: 10_000,
      effectiveRemainingMinor: 50_000,
      nowMs: NOW_MS,
      idempotencyKey: key,
    };

    const first = attemptRedemption({ ...base, attempt: 1 });
    expect(first.ok, "this key is chosen to fail on its first attempt").toBe(false);

    // The key MUST stay the same — that is what makes the call idempotent
    // (docs/09 section 8.1). Before `attempt` existed, the simulation keyed
    // off the idempotency key alone, so a correct retry recomputed the same
    // failing bucket and a cashier could never complete this redemption.
    const retry = attemptRedemption({ ...base, attempt: 2 });
    expect(retry.ok, "a transient failure must clear when retried").toBe(true);
  });
});
