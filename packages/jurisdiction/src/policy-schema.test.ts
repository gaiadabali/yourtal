import { describe, expect, it } from "vitest";
import {
  RESTRICTIVE_FALLBACK_POLICY,
  jurisdictionPolicySchema,
  parseJurisdictionPolicy,
} from "./policy-schema";

const VALID_POLICY = {
  cashOutEnabled: false,
  // Added with the field itself (YT-0602): the schema is strict, so a new
  // required prohibition cannot be introduced without every policy record
  // answering it. That propagation is the control working, not friction.
  userPointPurchaseEnabled: false,
  prizeDrawsEnabled: false,
  minimumAgeYears: 18,
  minimumAgeWithParentalConsentYears: 13,
  residencyVerificationRequired: true,
  minimumKycTier: "basic",
} as const;

describe("jurisdictionPolicySchema", () => {
  it("round-trips a fully-formed policy", () => {
    const result = jurisdictionPolicySchema.safeParse(VALID_POLICY);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(VALID_POLICY);
  });

  it("rejects an unknown switch (strict schema)", () => {
    const result = jurisdictionPolicySchema.safeParse({
      ...VALID_POLICY,
      cashOutLimitIdr: 100_000,
    });
    expect(result.success).toBe(false);
  });

  // AC2: a policy missing any single switch must not silently validate.
  it.each(Object.keys(VALID_POLICY))("rejects a policy missing '%s'", (missingKey) => {
    const broken = Object.fromEntries(
      Object.entries(VALID_POLICY).filter(([key]) => key !== missingKey),
    );
    expect(jurisdictionPolicySchema.safeParse(broken).success).toBe(false);
  });

  // AC2: malformed field values, not just missing ones.
  it.each([
    ["cashOutEnabled", "yes"],
    ["prizeDrawsEnabled", 1],
    ["minimumAgeYears", -5],
    ["minimumAgeYears", "18"],
    ["minimumAgeWithParentalConsentYears", -5],
    ["minimumAgeWithParentalConsentYears", "13"],
    ["residencyVerificationRequired", null],
    ["minimumKycTier", "platinum"],
  ])("rejects malformed '%s' value %j", (field, badValue) => {
    const broken = { ...VALID_POLICY, [field]: badValue };
    expect(jurisdictionPolicySchema.safeParse(broken).success).toBe(false);
  });
});

describe("parseJurisdictionPolicy", () => {
  it("returns the parsed policy on valid input", () => {
    expect(parseJurisdictionPolicy(VALID_POLICY)).toEqual(VALID_POLICY);
  });

  it("falls back to the restrictive policy on malformed input", () => {
    expect(parseJurisdictionPolicy({ ...VALID_POLICY, minimumAgeYears: "eighteen" })).toEqual(
      RESTRICTIVE_FALLBACK_POLICY,
    );
  });

  it("falls back to the restrictive policy on non-object input", () => {
    expect(parseJurisdictionPolicy(null)).toEqual(RESTRICTIVE_FALLBACK_POLICY);
    expect(parseJurisdictionPolicy(undefined)).toEqual(RESTRICTIVE_FALLBACK_POLICY);
    expect(parseJurisdictionPolicy("ID")).toEqual(RESTRICTIVE_FALLBACK_POLICY);
    expect(parseJurisdictionPolicy([])).toEqual(RESTRICTIVE_FALLBACK_POLICY);
  });

  it("the restrictive fallback is maximally restrictive on every axis", () => {
    // Never permissive: off switches, the higher age, residency required,
    // and the strongest KYC tier — AC2 stated as a property, not an example.
    expect(RESTRICTIVE_FALLBACK_POLICY.cashOutEnabled).toBe(false);
    expect(RESTRICTIVE_FALLBACK_POLICY.prizeDrawsEnabled).toBe(false);
    expect(RESTRICTIVE_FALLBACK_POLICY.residencyVerificationRequired).toBe(true);
    expect(RESTRICTIVE_FALLBACK_POLICY.minimumKycTier).toBe("enhanced");
    expect(RESTRICTIVE_FALLBACK_POLICY.minimumAgeYears).toBeGreaterThanOrEqual(18);
    expect(RESTRICTIVE_FALLBACK_POLICY.minimumAgeWithParentalConsentYears).toBeGreaterThanOrEqual(
      18,
    );
  });
});
