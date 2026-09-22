import { describe, expect, it } from "vitest";

import { jurisdictionCodeSchema } from "./jurisdiction-code";
import { JURISDICTION_POLICIES } from "./policy-data";
import { jurisdictionPolicySchema, RESTRICTIVE_FALLBACK_POLICY } from "./policy-schema";
import { VOIDING_RED_LINES } from "./voiding-red-lines";

/**
 * YT-0602. These assertions are written over the LIST rather than over the
 * two fields, so that adding a voiding red line without enforcing it fails
 * here — the criterion asks for the property, not the instance.
 */
describe("every red line that voids the YT-0012 acceptance is enforced", () => {
  it("lists at least the two known voiding red lines", () => {
    expect(VOIDING_RED_LINES.map((entry) => entry.redLine)).toEqual(expect.arrayContaining([3, 4]));
  });

  it("is locked off in every jurisdiction, for every listed red line", () => {
    for (const entry of VOIDING_RED_LINES) {
      for (const code of jurisdictionCodeSchema.options) {
        expect(
          JURISDICTION_POLICIES[code][entry.field],
          `red line ${entry.redLine} must be off in ${code}: ${entry.statement}`,
        ).toBe(false);
      }
    }
  });

  it("is locked off because it was DECLARED off, not because the record failed to parse", () => {
    // Found by sabotage: flipping the flag to `true` in `policy-data.ts`
    // does NOT make the assertion above fail. `z.literal(false)` makes the
    // record unparseable, `parseJurisdictionPolicy` falls back to
    // `RESTRICTIVE_FALLBACK_POLICY` by design (AC2), and the fallback also
    // has the flag off — so the test passed for the wrong reason while the
    // jurisdiction had silently lost its real policy.
    //
    // Failing safe is correct behaviour and is not the complaint. The
    // complaint is that a silent fallback is indistinguishable from a
    // correct record by looking at the prohibition alone, so this asserts
    // the record is live rather than substituted.
    for (const code of jurisdictionCodeSchema.options) {
      expect(
        JURISDICTION_POLICIES[code],
        `${code} is byte-identical to the restrictive fallback, which means its own record did not parse`,
      ).not.toEqual(RESTRICTIVE_FALLBACK_POLICY);
    }
  });

  it("is locked off in the restrictive fallback, which is what an unknown jurisdiction gets", () => {
    for (const entry of VOIDING_RED_LINES) {
      expect(RESTRICTIVE_FALLBACK_POLICY[entry.field]).toBe(false);
    }
  });

  it("names a field the policy actually has — so removing the prohibition fails here", () => {
    // The `keyof JurisdictionPolicy` type on `field` makes a deleted field a
    // compile error. This asserts it at runtime too, because a type is not
    // evidence once someone reaches for a cast.
    const shape = Object.keys(jurisdictionPolicySchema.shape);
    for (const entry of VOIDING_RED_LINES) {
      expect(shape).toContain(entry.field);
    }
  });
});

describe("red line 4 is unrepresentable rather than merely false", () => {
  // Red line 3 ends when a licensing project ships, so `cashOutEnabled` is a
  // boolean and `true` is a state the type permits. Red line 4 has no such
  // condition, so `true` must not parse at all.
  const valid = { ...JURISDICTION_POLICIES.ID };

  it("rejects a policy that enables user point purchase", () => {
    const result = jurisdictionPolicySchema.safeParse({
      ...valid,
      userPointPurchaseEnabled: true,
    });
    expect(result.success).toBe(false);
  });

  it("still accepts the policy as written, so the rejection is about the value", () => {
    expect(jurisdictionPolicySchema.safeParse(valid).success).toBe(true);
  });

  it("accepts cash-out being enabled, because THAT prohibition is conditional", () => {
    // Not an endorsement — it documents the difference between the two. If
    // this ever needs to fail too, red line 3 has stopped being conditional
    // and its type should change with it.
    const result = jurisdictionPolicySchema.safeParse({ ...valid, cashOutEnabled: true });
    expect(result.success).toBe(true);
  });

  it("the list agrees with the types about which prohibition is conditional", () => {
    for (const entry of VOIDING_RED_LINES) {
      const flipped = jurisdictionPolicySchema.safeParse({ ...valid, [entry.field]: true });
      expect(
        flipped.success,
        `red line ${entry.redLine} is marked conditional=${String(entry.conditional)}, so parsing true should ${
          entry.conditional ? "succeed" : "fail"
        }`,
      ).toBe(entry.conditional);
    }
  });
});
