import { describe, expect, it } from "vitest";
import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import {
  classifyAmount,
  recoveryForRedemptionError,
  type MerchantRedemptionError,
} from "./merchant-redemption-errors";

function preview(overrides: Partial<CounterVoucherPreview> = {}): CounterVoucherPreview {
  return {
    voucherId: "00000000-0000-4000-8000-000000000001",
    merchantName: "Test Merchant",
    offerTitle: "10% off",
    remainingValueMinor: 1000,
    currency: "AUD",
    partialRedemptionPolicy: "balance_carrying",
    ...overrides,
  };
}

describe("classifyAmount", () => {
  it("allows a partial amount on a balance_carrying voucher", () => {
    expect(classifyAmount(preview(), 500)).toBeNull();
  });

  it("allows the full remaining value on any policy", () => {
    expect(classifyAmount(preview({ partialRedemptionPolicy: "single_use" }), 1000)).toBeNull();
  });

  it("refuses zero or negative amounts", () => {
    expect(classifyAmount(preview(), 0)).toEqual({ code: "amount_not_positive" });
    expect(classifyAmount(preview(), -1)).toEqual({ code: "amount_not_positive" });
  });

  it("refuses an amount above the remaining value", () => {
    expect(classifyAmount(preview({ remainingValueMinor: 1000 }), 1500)).toEqual({
      code: "amount_exceeds_remaining_value",
      remainingValueMinor: 1000,
    });
  });

  it("refuses a partial amount on a single_use voucher", () => {
    expect(
      classifyAmount(preview({ partialRedemptionPolicy: "single_use", remainingValueMinor: 1000 }), 500),
    ).toEqual({ code: "requires_full_value_redemption", remainingValueMinor: 1000 });
  });
});

describe("recoveryForRedemptionError", () => {
  const cases: Array<[MerchantRedemptionError, string]> = [
    [{ code: "network_error" }, "retry"],
    [{ code: "amount_not_positive" }, "edit_amount"],
    [{ code: "amount_exceeds_remaining_value", remainingValueMinor: 1 }, "edit_amount"],
    [{ code: "requires_full_value_redemption", remainingValueMinor: 1 }, "edit_amount"],
    [{ code: "voucher_not_found" }, "new_redemption"],
    [{ code: "already_redeemed" }, "new_redemption"],
    [{ code: "expired" }, "new_redemption"],
    [{ code: "something_unmapped" }, "new_redemption"],
  ];

  for (const [error, expectedKind] of cases) {
    it(`maps "${error.code}" to "${expectedKind}"`, () => {
      expect(recoveryForRedemptionError(error).kind).toBe(expectedKind);
    });
  }
});
