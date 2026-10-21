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
  it("lets anyone earn when the check does not apply", () => {
    expect(judgeEarningIdentity(false, { emailVerified: false, passkeyCount: 0 })).toEqual({
      mayEarn: true,
    });
  });

  it("refuses an unverified email", () => {
    expect(judgeEarningIdentity(true, { emailVerified: false, passkeyCount: 1 })).toEqual({
      mayEarn: false,
      missing: ["verify_email"],
    });
  });

  it("refuses an account with no passkey", () => {
    expect(judgeEarningIdentity(true, { emailVerified: true, passkeyCount: 0 })).toEqual({
      mayEarn: false,
      missing: ["add_passkey"],
    });
  });

  it("names both steps when both are missing, email first", () => {
    expect(judgeEarningIdentity(true, { emailVerified: false, passkeyCount: 0 })).toEqual({
      mayEarn: false,
      missing: ["verify_email", "add_passkey"],
    });
  });

  it("lets a verified email with a passkey earn", () => {
    expect(judgeEarningIdentity(true, { emailVerified: true, passkeyCount: 2 })).toEqual({
      mayEarn: true,
    });
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
