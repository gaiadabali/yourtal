import { describe, expect, it } from "vitest";
import {
  identityCheckApplies,
  judgeEarningIdentity,
  pointsIdentityCheckSettingSchema,
} from "./earning-check";

describe("identityCheckApplies (F126)", () => {
  it("is forced on in production, whatever the region setting says", () => {
    expect(identityCheckApplies("production", undefined)).toBe(true);
    expect(identityCheckApplies("production", null)).toBe(true);
    expect(identityCheckApplies("production", { enabled: false })).toBe(true);
  });

  it("follows the region setting on staging and dev", () => {
    expect(identityCheckApplies("staging", { enabled: true })).toBe(true);
    expect(identityCheckApplies("staging", { enabled: false })).toBe(false);
    expect(identityCheckApplies("dev", { enabled: true })).toBe(true);
  });

  it("reads a missing or malformed setting as off outside production", () => {
    expect(identityCheckApplies("staging", null)).toBe(false);
    expect(identityCheckApplies("staging", undefined)).toBe(false);
    expect(identityCheckApplies("staging", true)).toBe(false);
    expect(identityCheckApplies("staging", { enabled: "yes" })).toBe(false);
    expect(identityCheckApplies("dev", { enabled: true, extra: 1 })).toBe(false);
  });
});

describe("judgeEarningIdentity", () => {
  const verified = "viewer@gmail.com";

  it("lets anyone earn when the check does not apply", () => {
    expect(
      judgeEarningIdentity(false, { emailVerified: false, email: "x@mailinator.com" }),
    ).toEqual({ mayEarn: true });
  });

  it("refuses an unverified email", () => {
    expect(judgeEarningIdentity(true, { emailVerified: false, email: verified })).toEqual({
      mayEarn: false,
      missing: ["verify_email"],
    });
  });

  it("refuses a disposable domain even when it is verified, and a subdomain of one", () => {
    for (const email of ["x@mailinator.com", "x@Inbox.MAILINATOR.com"]) {
      expect(judgeEarningIdentity(true, { emailVerified: true, email })).toEqual({
        mayEarn: false,
        missing: ["use_permanent_email"],
      });
    }
  });

  it("names both steps when both are missing, verification first", () => {
    expect(judgeEarningIdentity(true, { emailVerified: false, email: "x@yopmail.com" })).toEqual({
      mayEarn: false,
      missing: ["verify_email", "use_permanent_email"],
    });
  });

  it("refuses an account with no sign-in email at all", () => {
    expect(judgeEarningIdentity(true, { emailVerified: false, email: null })).toEqual({
      mayEarn: false,
      missing: ["verify_email"],
    });
  });

  it("lets a verified permanent email earn, the demo domains included", () => {
    for (const email of [verified, "v@demo.yourtal.test", "v@example.test"]) {
      expect(judgeEarningIdentity(true, { emailVerified: true, email })).toEqual({
        mayEarn: true,
      });
    }
  });
});

describe("pointsIdentityCheckSettingSchema", () => {
  it("accepts only {enabled: boolean}", () => {
    expect(pointsIdentityCheckSettingSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(pointsIdentityCheckSettingSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(pointsIdentityCheckSettingSchema.safeParse({}).success).toBe(false);
    expect(pointsIdentityCheckSettingSchema.safeParse(true).success).toBe(false);
    expect(pointsIdentityCheckSettingSchema.safeParse({ enabled: 1 }).success).toBe(false);
    expect(pointsIdentityCheckSettingSchema.safeParse({ enabled: true, on: true }).success).toBe(
      false,
    );
  });
});
