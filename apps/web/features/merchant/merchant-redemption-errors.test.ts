import { describe, expect, it } from "vitest";
import type { Voucher } from "@yourtal/contracts/voucher";
import { rupiah, toIdrMinorUnits } from "@yourtal/contracts/money";
import {
  classifyRedemptionEligibility,
  recoveryForRedemptionError,
} from "./merchant-redemption-errors";

const NOW_MS = Date.parse("2026-09-19T09:00:00.000Z");

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: "voucher-1",
    listingId: "listing-1",
    ownerId: "owner-1",
    code: "ABC12345",
    merchantId: "00000000-0000-4000-8000-000000000601",
    merchantName: "Toko Berkah",
    minimumSpendIdr: null,
    title: "Voucher Toko Berkah",
    faceValueIdr: rupiah(50_000),
    remainingValueIdr: rupiah(50_000),
    partialRedemptionPolicy: "balance_carrying",
    transferable: false,
    status: "active",
    issuedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
    // The final cast covers the plain-number defaults above; any override
    // touching a branded money field (see the `toIdrMinorUnits` calls at
    // the call sites below) must go through the real constructor, since
    // `Partial<Voucher>` is checked at the call site, before this cast
    // ever applies.
  } as Voucher;
}

describe("classifyRedemptionEligibility", () => {
  it("allows a fully eligible redemption", () => {
    const voucher = makeVoucher();
    const error = classifyRedemptionEligibility({
      voucher,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: 30_000,
      effectiveRemainingMinor: 50_000,
      nowMs: NOW_MS,
    });
    expect(error).toBeNull();
  });

  it("refuses an already-redeemed voucher before checking anything else", () => {
    const voucher = makeVoucher({ status: "redeemed", merchantName: "Some Other Shop" });
    const error = classifyRedemptionEligibility({
      voucher,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: 10_000,
      effectiveRemainingMinor: 50_000,
      nowMs: NOW_MS,
    });
    expect(error).toEqual({ type: "already_redeemed" });
  });

  it("refuses an expired voucher ahead of a wrong-merchant mismatch — expiry is checked first", () => {
    const voucher = makeVoucher({
      expiresAt: "2026-09-18T00:00:00.000Z",
      merchantName: "Some Other Shop",
    });
    const error = classifyRedemptionEligibility({
      voucher,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: 10_000,
      effectiveRemainingMinor: 50_000,
      nowMs: NOW_MS,
    });
    expect(error).toEqual({ type: "expired", expiresAt: voucher.expiresAt });
  });

  // These two encode WHY `voucherSchema` gained `merchantId`. Before it,
  // this check string-compared `merchantName`, so both cases below were
  // wrong: a renamed outlet invalidated vouchers already in wallets, and
  // two merchants sharing a name could redeem each other's.
  it("still honours a voucher after the merchant renames the outlet", () => {
    const renamed = makeVoucher({
      merchantId: "00000000-0000-4000-8000-000000000601",
      merchantName: "Toko Berkah Senayan",
    });
    const error = classifyRedemptionEligibility({
      voucher: renamed,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: rupiah(10_000),
      effectiveRemainingMinor: rupiah(50_000),
      nowMs: NOW_MS,
    });
    expect(error).toBeNull();
  });

  it("refuses a different merchant that happens to share the same display name", () => {
    const impostor = makeVoucher({
      merchantId: "00000000-0000-4000-8000-000000000602",
      merchantName: "Toko Berkah",
    });
    const error = classifyRedemptionEligibility({
      voucher: impostor,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: rupiah(10_000),
      effectiveRemainingMinor: rupiah(50_000),
      nowMs: NOW_MS,
    });
    expect(error?.type).toBe("wrong_merchant");
  });

  it("refuses a voucher minted for a different merchant", () => {
    const voucher = makeVoucher({
      merchantId: "00000000-0000-4000-8000-000000000602",
      merchantName: "Kopi Kenangan Kemang",
    });
    const error = classifyRedemptionEligibility({
      voucher,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: 10_000,
      effectiveRemainingMinor: 50_000,
      nowMs: NOW_MS,
    });
    expect(error).toEqual({
      type: "wrong_merchant",
      voucherMerchantName: "Kopi Kenangan Kemang",
      deviceMerchantName: "Toko Berkah",
    });
  });

  it("refuses a non-positive amount", () => {
    const voucher = makeVoucher();
    const error = classifyRedemptionEligibility({
      voucher,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: 0,
      effectiveRemainingMinor: 50_000,
      nowMs: NOW_MS,
    });
    expect(error).toEqual({ type: "amount_not_positive" });
  });

  it("refuses an amount exceeding the effective remaining value, not the voucher's raw field", () => {
    const voucher = makeVoucher({ remainingValueIdr: rupiah(50_000) });
    const error = classifyRedemptionEligibility({
      voucher,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: 20_000,
      effectiveRemainingMinor: 15_000, // already partly consumed today
      nowMs: NOW_MS,
    });
    expect(error).toEqual({ type: "amount_exceeds_remaining_value", remainingValueMinor: 15_000 });
  });

  it("requires a minimum_spend voucher to be redeemed in full", () => {
    const voucher = makeVoucher({
      partialRedemptionPolicy: "minimum_spend",
      remainingValueIdr: rupiah(100_000),
    });
    const error = classifyRedemptionEligibility({
      voucher,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: 50_000,
      effectiveRemainingMinor: 100_000,
      nowMs: NOW_MS,
    });
    expect(error).toEqual({ type: "requires_full_value_redemption", remainingValueMinor: 100_000 });
  });

  it("allows a minimum_spend voucher redeemed for its exact full value", () => {
    const voucher = makeVoucher({
      partialRedemptionPolicy: "minimum_spend",
      remainingValueIdr: rupiah(100_000),
    });
    const error = classifyRedemptionEligibility({
      voucher,
      deviceMerchantId: "00000000-0000-4000-8000-000000000601",
      deviceMerchantName: "Toko Berkah",
      amountMinor: 100_000,
      effectiveRemainingMinor: 100_000,
      nowMs: NOW_MS,
    });
    expect(error).toBeNull();
  });
});

describe("recoveryForRedemptionError", () => {
  it("offers retry only for a network error", () => {
    expect(recoveryForRedemptionError({ type: "network_error" })).toEqual({ kind: "retry" });
  });

  it("offers edit_amount for amount-shaped errors", () => {
    expect(recoveryForRedemptionError({ type: "amount_not_positive" })).toEqual({
      kind: "edit_amount",
    });
    expect(
      recoveryForRedemptionError({
        type: "amount_exceeds_remaining_value",
        remainingValueMinor: 1,
      }),
    ).toEqual({
      kind: "edit_amount",
    });
    expect(
      recoveryForRedemptionError({
        type: "requires_full_value_redemption",
        remainingValueMinor: 1,
      }),
    ).toEqual({
      kind: "edit_amount",
    });
  });

  it("offers new_redemption for every fact-about-the-voucher error", () => {
    expect(recoveryForRedemptionError({ type: "voucher_not_found" })).toEqual({
      kind: "new_redemption",
    });
    expect(recoveryForRedemptionError({ type: "already_redeemed" })).toEqual({
      kind: "new_redemption",
    });
    expect(
      recoveryForRedemptionError({ type: "expired", expiresAt: "2026-01-01T00:00:00.000Z" }),
    ).toEqual({
      kind: "new_redemption",
    });
    expect(
      recoveryForRedemptionError({
        type: "wrong_merchant",
        voucherMerchantName: "A",
        deviceMerchantName: "B",
      }),
    ).toEqual({ kind: "new_redemption" });
  });
});
