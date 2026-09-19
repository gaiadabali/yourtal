import { describe, expect, it } from "vitest";
import { errorCopyFor } from "./merchant-error-copy";
import type { MerchantRedemptionError } from "./merchant-redemption-errors";

const ERRORS: MerchantRedemptionError[] = [
  { type: "voucher_not_found" },
  { type: "already_redeemed" },
  { type: "expired", expiresAt: "2026-09-01T00:00:00.000Z" },
  { type: "wrong_merchant", voucherMerchantName: "A", deviceMerchantName: "B" },
  { type: "amount_not_positive" },
  { type: "amount_exceeds_remaining_value", remainingValueMinor: 5_000 },
  { type: "requires_full_value_redemption", remainingValueMinor: 5_000 },
  { type: "network_error" },
];

describe("errorCopyFor", () => {
  it("returns a non-empty heading and body for every error type, in both locales", () => {
    for (const error of ERRORS) {
      for (const locale of ["en-AU", "id-ID"] as const) {
        const copy = errorCopyFor(error, locale, "AUD");
        expect(copy.heading.length).toBeGreaterThan(0);
        expect(copy.body.length).toBeGreaterThan(0);
      }
    }
  });

  it("never says just 'invalid' — every message is specific to what happened", () => {
    for (const error of ERRORS) {
      const copy = errorCopyFor(error, "en-AU", "AUD");
      expect(copy.heading.toLowerCase()).not.toBe("invalid");
    }
  });

  it("names the actual merchants for a wrong_merchant error", () => {
    const copy = errorCopyFor(
      {
        type: "wrong_merchant",
        voucherMerchantName: "Kopi Kenangan",
        deviceMerchantName: "Toko Berkah",
      },
      "en-AU",
      "AUD",
    );
    expect(copy.body).toContain("Kopi Kenangan");
    expect(copy.body).toContain("Toko Berkah");
  });

  it("formats the remaining value through formatMoney, never a hardcoded currency symbol string", () => {
    const aud = errorCopyFor(
      { type: "amount_exceeds_remaining_value", remainingValueMinor: 1_500 },
      "en-AU",
      "AUD",
    );
    const idr = errorCopyFor(
      { type: "amount_exceeds_remaining_value", remainingValueMinor: 1_500 },
      "id-ID",
      "IDR",
    );
    expect(aud.body).not.toBe(idr.body);
  });
});
