import { describe, expect, it } from "vitest";
import {
  buildRedemptionInstructions,
  describePartialRedemptionPolicy,
} from "./wallet-redemption-copy";
import { walletTestTranslator } from "./wallet-test-translator";

describe("describePartialRedemptionPolicy", () => {
  const t = walletTestTranslator("id-ID");

  it("explains balance-carrying in plain Indonesian", () => {
    expect(describePartialRedemptionPolicy("balance_carrying", t)).toMatch(/sisanya tetap tersimpan/);
  });

  it("explains single-use-forfeit in plain Indonesian, including that the remainder is lost", () => {
    expect(describePartialRedemptionPolicy("single_use_forfeit", t)).toMatch(/hangus/);
  });

  it("explains minimum-spend in plain Indonesian", () => {
    expect(describePartialRedemptionPolicy("minimum_spend", t)).toMatch(/minimum/);
  });
});

describe("buildRedemptionInstructions", () => {
  const t = walletTestTranslator("id-ID");

  it("names the specific merchant, not a generic placeholder", () => {
    const instructions = buildRedemptionInstructions("Kopi Sentosa", "balance_carrying", t);
    expect(instructions).toContain("Kopi Sentosa");
  });

  it("folds in the policy explanation for this batch", () => {
    const instructions = buildRedemptionInstructions("Kopi Sentosa", "single_use_forfeit", t);
    expect(instructions).toMatch(/hangus/);
  });

  it("gives different instructions for different merchants", () => {
    const a = buildRedemptionInstructions("Kopi Sentosa", "balance_carrying", t);
    const b = buildRedemptionInstructions("Toko Berkah", "balance_carrying", t);
    expect(a).not.toBe(b);
  });
});

describe("en-AU", () => {
  const t = walletTestTranslator("en-AU");

  it("explains every policy in English", () => {
    expect(describePartialRedemptionPolicy("balance_carrying", t)).toMatch(/kept for next time/);
    expect(describePartialRedemptionPolicy("single_use_forfeit", t)).toMatch(/forfeited/);
    expect(describePartialRedemptionPolicy("minimum_spend", t)).toMatch(/minimum amount/);
  });

  it("names the merchant and folds in the policy in English, with no Indonesian copy leaking through", () => {
    const instructions = buildRedemptionInstructions("Sydney Coffee Co", "single_use_forfeit", t);
    expect(instructions).toContain("Sydney Coffee Co");
    expect(instructions).toMatch(/forfeited/);
    expect(instructions).not.toMatch(/kasir|hangus/);
  });
});
