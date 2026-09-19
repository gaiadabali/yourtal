import { describe, expect, it } from "vitest";
import { kycTierSchema, satisfiesKycTier } from "./kyc-tier";

describe("kycTierSchema", () => {
  it("accepts the four defined tiers", () => {
    for (const tier of ["none", "basic", "verified", "enhanced"]) {
      expect(kycTierSchema.safeParse(tier).success).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(kycTierSchema.safeParse("gold").success).toBe(false);
    expect(kycTierSchema.safeParse("").success).toBe(false);
    expect(kycTierSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("satisfiesKycTier", () => {
  it("is true when held is exactly the required tier", () => {
    expect(satisfiesKycTier("verified", "verified")).toBe(true);
  });

  it("is true when held is stronger than required", () => {
    expect(satisfiesKycTier("enhanced", "basic")).toBe(true);
  });

  it("is false when held is weaker than required", () => {
    expect(satisfiesKycTier("none", "basic")).toBe(false);
    expect(satisfiesKycTier("basic", "enhanced")).toBe(false);
  });
});
