import { describe, expect, it } from "vitest";
import {
  buildRedemptionInstructions,
  describePartialRedemptionPolicy,
} from "./wallet-redemption-copy";

describe("describePartialRedemptionPolicy", () => {
  it("explains balance-carrying in plain Indonesian", () => {
    expect(describePartialRedemptionPolicy("balance_carrying", "id-ID")).toMatch(
      /sisanya tetap tersimpan/,
    );
  });

  it("explains single-use-forfeit in plain Indonesian, including that the remainder is lost", () => {
    expect(describePartialRedemptionPolicy("single_use_forfeit", "id-ID")).toMatch(/hangus/);
  });

  it("explains minimum-spend in plain Indonesian", () => {
    expect(describePartialRedemptionPolicy("minimum_spend", "id-ID")).toMatch(/minimum/);
  });
});

describe("buildRedemptionInstructions", () => {
  it("names the specific merchant, not a generic placeholder", () => {
    const instructions = buildRedemptionInstructions("Kopi Sentosa", "balance_carrying", "id-ID");
    expect(instructions).toContain("Kopi Sentosa");
  });

  it("folds in the policy explanation for this batch", () => {
    const instructions = buildRedemptionInstructions("Kopi Sentosa", "single_use_forfeit", "id-ID");
    expect(instructions).toMatch(/hangus/);
  });

  it("gives different instructions for different merchants", () => {
    const a = buildRedemptionInstructions("Kopi Sentosa", "balance_carrying", "id-ID");
    const b = buildRedemptionInstructions("Toko Berkah", "balance_carrying", "id-ID");
    expect(a).not.toBe(b);
  });
});

describe("en-AU (YT-0405)", () => {
  it("explains every policy in English", () => {
    expect(describePartialRedemptionPolicy("balance_carrying", "en-AU")).toMatch(
      /kept for next time/,
    );
    expect(describePartialRedemptionPolicy("single_use_forfeit", "en-AU")).toMatch(/forfeited/);
    expect(describePartialRedemptionPolicy("minimum_spend", "en-AU")).toMatch(/minimum amount/);
  });

  it("names the merchant and folds in the policy in English, with no Indonesian copy leaking through", () => {
    const instructions = buildRedemptionInstructions(
      "Sydney Coffee Co",
      "single_use_forfeit",
      "en-AU",
    );
    expect(instructions).toContain("Sydney Coffee Co");
    expect(instructions).toMatch(/forfeited/);
    expect(instructions).not.toMatch(/kasir|hangus/);
  });
});
