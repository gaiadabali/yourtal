import { describe, expect, it } from "vitest";
import { rupiah, toIdrMinorUnits } from "@yourtal/contracts/money";
import { audCents } from "@yourtal/contracts/money/value";
import {
  partialRedemptionPolicyDescription,
  partialRedemptionPolicyLabel,
  transferabilityDescription,
} from "./store-redemption-policy";

describe("partialRedemptionPolicyLabel", () => {
  it("labels every policy distinctly", () => {
    expect(partialRedemptionPolicyLabel("balance_carrying")).toBe("Sisa saldo tersimpan");
    expect(partialRedemptionPolicyLabel("single_use_forfeit")).toBe("Sekali pakai, sisa hangus");
    expect(partialRedemptionPolicyLabel("minimum_spend")).toBe("Ada minimum belanja");
  });
});

describe("partialRedemptionPolicyDescription", () => {
  it("explains that the remainder carries over as a balance", () => {
    expect(partialRedemptionPolicyDescription("balance_carrying", null)).toMatch(/tersimpan/i);
  });

  it("explains that the remainder is forfeited", () => {
    expect(partialRedemptionPolicyDescription("single_use_forfeit", null)).toMatch(/hangus/i);
  });

  it("states the minimum spend amount when the policy requires one", () => {
    expect(partialRedemptionPolicyDescription("minimum_spend", rupiah(75_000))).toContain("75.000");
  });
});

describe("transferabilityDescription", () => {
  it("describes one-hop, verified-recipient transfer when transferable", () => {
    expect(transferabilityDescription(true)).toMatch(/satu pengguna/i);
  });

  it("states plainly that transfer is not possible otherwise", () => {
    expect(transferabilityDescription(false)).toMatch(/tidak bisa/i);
  });
});

describe("en-AU (YT-0405)", () => {
  it("labels every policy distinctly in English", () => {
    expect(partialRedemptionPolicyLabel("balance_carrying", "en-AU")).toBe(
      "Remaining balance carries over",
    );
    expect(partialRedemptionPolicyLabel("single_use_forfeit", "en-AU")).toBe(
      "Single use, remainder forfeited",
    );
    expect(partialRedemptionPolicyLabel("minimum_spend", "en-AU")).toBe("Minimum spend applies");
  });

  it("states the minimum spend amount in AUD, never a hardcoded Rp", () => {
    const description = partialRedemptionPolicyDescription(
      "minimum_spend",
      audCents(7_500),
      "en-AU",
      "AUD",
    );
    expect(description).toContain("$75.00");
    expect(description).not.toContain("Rp");
  });

  it("falls back to an unspecified-minimum sentence in English when no amount is given", () => {
    expect(partialRedemptionPolicyDescription("minimum_spend", null, "en-AU", "AUD")).toMatch(
      /minimum spend/i,
    );
  });

  it("describes transferability in English", () => {
    expect(transferabilityDescription(true, "en-AU")).toMatch(/transferred once/i);
    expect(transferabilityDescription(false, "en-AU")).toMatch(/cannot be transferred/i);
  });
});
