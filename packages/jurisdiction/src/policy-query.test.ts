import { describe, expect, it } from "vitest";
import {
  mayCashOut,
  mayRunPrizeDraw,
  meetsKycTier,
  meetsMinimumAge,
  meetsResidencyRequirement,
} from "./policy-query";

describe("mayCashOut", () => {
  it("denies cash-out in ID and AU (neither is licensed yet)", () => {
    expect(mayCashOut("ID")).toEqual({
      allowed: false,
      reason: { type: "feature_disabled", switchName: "cashOutEnabled" },
    });
    expect(mayCashOut("AU")).toEqual({
      allowed: false,
      reason: { type: "feature_disabled", switchName: "cashOutEnabled" },
    });
  });

  it("denies cash-out for an unknown jurisdiction, with the specific reason", () => {
    expect(mayCashOut("US")).toEqual({
      allowed: false,
      reason: { type: "unknown_jurisdiction", jurisdiction: "US" },
    });
  });
});

describe("mayRunPrizeDraw", () => {
  it("denies prize draws by default in both markets", () => {
    expect(mayRunPrizeDraw("ID").allowed).toBe(false);
    expect(mayRunPrizeDraw("AU").allowed).toBe(false);
  });

  it("denies an unknown jurisdiction rather than defaulting to allowed", () => {
    const decision = mayRunPrizeDraw("XX");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason.type).toBe("unknown_jurisdiction");
    }
  });
});

describe("meetsMinimumAge", () => {
  it("allows an adult in both markets", () => {
    expect(meetsMinimumAge("ID", 25).allowed).toBe(true);
    expect(meetsMinimumAge("AU", 25).allowed).toBe(true);
  });

  it("denies someone below the minimum, with the required/actual ages", () => {
    expect(meetsMinimumAge("ID", 15)).toEqual({
      allowed: false,
      reason: { type: "below_minimum_age", requiredYears: 18, actualYears: 15 },
    });
  });

  it("denies exactly-one-year-under, at the boundary", () => {
    const decision = meetsMinimumAge("AU", 17);
    expect(decision.allowed).toBe(false);
  });

  it("fails closed for an unknown jurisdiction regardless of stated age", () => {
    const decision = meetsMinimumAge("XX", 99);
    expect(decision.allowed).toBe(false);
  });
});

describe("meetsResidencyRequirement", () => {
  it("allows a verified resident in both markets", () => {
    expect(meetsResidencyRequirement("ID", true).allowed).toBe(true);
    expect(meetsResidencyRequirement("AU", true).allowed).toBe(true);
  });

  it("denies an unverified resident where residency is required", () => {
    expect(meetsResidencyRequirement("ID", false)).toEqual({
      allowed: false,
      reason: { type: "residency_unverified" },
    });
  });

  it("fails closed for an unknown jurisdiction even when residency is claimed verified", () => {
    const decision = meetsResidencyRequirement("XX", true);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason.type).toBe("unknown_jurisdiction");
    }
  });
});

describe("meetsKycTier", () => {
  it("allows a tier at or above the jurisdiction's minimum", () => {
    expect(meetsKycTier("ID", "verified").allowed).toBe(true);
    expect(meetsKycTier("ID", "enhanced").allowed).toBe(true);
    expect(meetsKycTier("AU", "basic").allowed).toBe(true);
  });

  it("denies a tier below the jurisdiction's minimum, naming both tiers", () => {
    expect(meetsKycTier("ID", "basic")).toEqual({
      allowed: false,
      reason: { type: "kyc_tier_insufficient", requiredTier: "verified", heldTier: "basic" },
    });
  });

  it("fails closed for an unknown jurisdiction even at the strongest held tier", () => {
    const decision = meetsKycTier("XX", "enhanced");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason.type).toBe("unknown_jurisdiction");
    }
  });
});
