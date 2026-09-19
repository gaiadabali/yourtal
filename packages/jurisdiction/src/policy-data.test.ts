import { describe, expect, it } from "vitest";
import { JURISDICTION_POLICIES, resolvePolicy } from "./policy-data";
import { RESTRICTIVE_FALLBACK_POLICY } from "./policy-schema";

describe("JURISDICTION_POLICIES", () => {
  it("defines both ID and AU, each a fully-formed policy", () => {
    expect(JURISDICTION_POLICIES.ID.cashOutEnabled).toBe(false);
    expect(JURISDICTION_POLICIES.AU.cashOutEnabled).toBe(false);
    expect(JURISDICTION_POLICIES.ID.minimumAgeYears).toBeGreaterThan(0);
    expect(JURISDICTION_POLICIES.AU.minimumAgeYears).toBeGreaterThan(0);
  });

  it("does not accidentally ship with cash-out or draws switched on", () => {
    // Red line #3 (docs/24): no cash withdrawal in either market until
    // licensed. A test, not just a comment, so this cannot regress silently.
    for (const policy of Object.values(JURISDICTION_POLICIES)) {
      expect(policy.cashOutEnabled).toBe(false);
      expect(policy.prizeDrawsEnabled).toBe(false);
    }
  });
});

describe("resolvePolicy", () => {
  it("resolves 'ID' and 'AU' to their real policies", () => {
    expect(resolvePolicy("ID")).toEqual(JURISDICTION_POLICIES.ID);
    expect(resolvePolicy("AU")).toEqual(JURISDICTION_POLICIES.AU);
  });

  // AC2: the unknown-jurisdiction fail-closed case.
  it.each(["US", "SG", "id", "au", "", "null", "ID "])(
    "resolves unknown jurisdiction %j to the restrictive fallback",
    (code) => {
      expect(resolvePolicy(code)).toEqual(RESTRICTIVE_FALLBACK_POLICY);
    },
  );
});
