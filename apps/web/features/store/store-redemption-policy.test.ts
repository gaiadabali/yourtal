import { describe, expect, it } from "vitest";
import { toIdrMinorUnits } from "@yourtal/contracts/money";
import { partialRedemptionPolicyDescription, partialRedemptionPolicyLabel, transferabilityDescription } from "./store-redemption-policy";

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
    expect(partialRedemptionPolicyDescription("minimum_spend", toIdrMinorUnits(75_000))).toContain("75.000");
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
