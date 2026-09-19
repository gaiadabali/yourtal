import { describe, expect, it } from "vitest";
import { buildRedemptionInstructions, describePartialRedemptionPolicy } from "./wallet-redemption-copy";

describe("describePartialRedemptionPolicy", () => {
  it("explains balance-carrying in plain Indonesian", () => {
    expect(describePartialRedemptionPolicy("balance_carrying")).toMatch(/sisanya tetap tersimpan/);
  });

  it("explains single-use-forfeit in plain Indonesian, including that the remainder is lost", () => {
    expect(describePartialRedemptionPolicy("single_use_forfeit")).toMatch(/hangus/);
  });

  it("explains minimum-spend in plain Indonesian", () => {
    expect(describePartialRedemptionPolicy("minimum_spend")).toMatch(/minimum/);
  });
});

describe("buildRedemptionInstructions", () => {
  it("names the specific merchant, not a generic placeholder", () => {
    const instructions = buildRedemptionInstructions("Kopi Sentosa", "balance_carrying");
    expect(instructions).toContain("Kopi Sentosa");
  });

  it("folds in the policy explanation for this batch", () => {
    const instructions = buildRedemptionInstructions("Kopi Sentosa", "single_use_forfeit");
    expect(instructions).toMatch(/hangus/);
  });

  it("gives different instructions for different merchants", () => {
    const a = buildRedemptionInstructions("Kopi Sentosa", "balance_carrying");
    const b = buildRedemptionInstructions("Toko Berkah", "balance_carrying");
    expect(a).not.toBe(b);
  });
});
