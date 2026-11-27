import { describe, expect, it } from "vitest";
import { mayUseSignalFor } from "./consent-query";
import {
  GOD_GROUP_NOTICE,
  adultShouldBeAsked,
  godConsentRecordSchema,
  guardianShouldBeAsked,
  isInGod,
  toConsentRecord,
} from "./god-group-notice";
import type { GodConsentRecord } from "./god-group-notice";

const USER = "11111111-1111-4111-8111-111111111111";

function decided(over: Partial<GodConsentRecord> = {}): GodConsentRecord {
  return godConsentRecordSchema.parse({
    userId: USER,
    region: "AU",
    noticeId: GOD_GROUP_NOTICE.id,
    noticeVersion: GOD_GROUP_NOTICE.version,
    decision: "accepted",
    method: "registration",
    track: "adult",
    guardianUserId: null,
    recordedAt: "2026-11-27T00:00:00Z",
    ...over,
  });
}

const NEXT_VERSION = { ...GOD_GROUP_NOTICE, version: "1.2" };

describe("the notice", () => {
  it("is the shared contract the three apps record against", () => {
    expect(GOD_GROUP_NOTICE).toStrictEqual({
      id: "god-group-notice",
      version: "1.1",
      effectiveFrom: "2026-11-27",
      url: "https://god.gaiada.com/privacy-notice/",
      teensUrl: "https://god.gaiada.com/privacy-notice/#teens",
    });
  });
});

describe("asking an adult", () => {
  it("asks someone who has never decided", () => {
    expect(adultShouldBeAsked(null, "adult")).toBe(true);
  });

  it.each(["accepted", "declined", "withdrawn"] as const)(
    "does not ask again after %s at the current version",
    (decision) => {
      const method = decision === "withdrawn" ? "request" : "next_sign_in";
      expect(adultShouldBeAsked(decided({ decision, method }), "adult")).toBe(false);
    },
  );

  it.each(["accepted", "declined", "withdrawn"] as const)(
    "asks again after %s once the version changes",
    (decision) => {
      const method = decision === "withdrawn" ? "request" : "next_sign_in";
      expect(adultShouldBeAsked(decided({ decision, method }), "adult", NEXT_VERSION)).toBe(true);
    },
  );

  it("never asks a teen: their guardian decides", () => {
    expect(adultShouldBeAsked(null, "teen")).toBe(false);
  });

  it("asks a former teen whose guardian decided for them", () => {
    const byGuardian = decided({ method: "guardian", track: "teen" });
    expect(adultShouldBeAsked(byGuardian, "adult")).toBe(true);
  });
});

describe("asking a guardian", () => {
  it("asks when nothing is on file, and again when the version changes", () => {
    expect(guardianShouldBeAsked(null)).toBe(true);
    const accepted = decided({ method: "guardian", track: "teen" });
    expect(guardianShouldBeAsked(accepted)).toBe(false);
    expect(guardianShouldBeAsked(accepted, NEXT_VERSION)).toBe(true);
  });

  it("does not re-ask after the teen asked to stop", () => {
    const withdrawn = decided({ decision: "withdrawn", method: "request", track: "teen" });
    expect(guardianShouldBeAsked(withdrawn)).toBe(false);
  });
});

describe("who is in GOD", () => {
  it("only an acceptance of the current version counts", () => {
    expect(isInGod(decided(), "adult")).toBe(true);
    expect(isInGod(decided(), "adult", NEXT_VERSION)).toBe(false);
    expect(isInGod(decided({ decision: "declined", method: "next_sign_in" }), "adult")).toBe(false);
    expect(isInGod(decided({ decision: "withdrawn", method: "request" }), "adult")).toBe(false);
    expect(isInGod(null, "adult")).toBe(false);
  });

  it("an acceptance of v1.0 (before the Indonesia hosting correction) no longer counts", () => {
    const v10 = decided({ noticeVersion: "1.0" });
    expect(isInGod(v10, "adult")).toBe(false);
    expect(adultShouldBeAsked(v10, "adult")).toBe(true);
  });

  it("a teen counts only through their guardian, on the teen track", () => {
    expect(isInGod(decided({ method: "guardian", track: "teen" }), "teen")).toBe(true);
    expect(isInGod(decided({ track: "teen" }), "teen")).toBe(false);
    expect(isInGod(decided(), "teen")).toBe(false);
  });
});

describe("god_group_insights through mayUseSignalFor", () => {
  it("allows an adult who accepted the current notice", () => {
    const decision = mayUseSignalFor({
      purpose: "god_group_insights",
      jurisdiction: "AU",
      records: [toConsentRecord(decided())],
      currentPhase: "P1",
      ageBand: "adult",
    });
    expect(decision).toEqual({
      allowed: true,
      basis: { type: "consent", policyVersionId: "god-group-notice@1.1" },
    });
  });

  it("reads a decline as no", () => {
    const decision = mayUseSignalFor({
      purpose: "god_group_insights",
      jurisdiction: "AU",
      records: [toConsentRecord(decided({ decision: "declined", method: "next_sign_in" }))],
      currentPhase: "P1",
    });
    expect(decision.allowed).toBe(false);
  });

  it("allows a teen only when the guardian accepted", () => {
    const byGuardian = mayUseSignalFor({
      purpose: "god_group_insights",
      jurisdiction: "AU",
      records: [toConsentRecord(decided({ method: "guardian", track: "teen" }))],
      currentPhase: "P1",
      ageBand: "teen",
    });
    expect(byGuardian.allowed).toBe(true);

    const bySelf = mayUseSignalFor({
      purpose: "god_group_insights",
      jurisdiction: "AU",
      records: [toConsentRecord(decided({ method: "next_sign_in", track: "teen" }))],
      currentPhase: "P1",
      ageBand: "teen",
    });
    expect(bySelf).toEqual({ allowed: false, reason: { type: "teen_consent_not_allowed" } });
  });

  it("treats an acceptance of an older notice as stale", () => {
    const decision = mayUseSignalFor({
      purpose: "god_group_insights",
      jurisdiction: "AU",
      records: [toConsentRecord(decided({ noticeVersion: "0.9" }))],
      currentPhase: "P1",
    });
    expect(decision).toEqual({
      allowed: false,
      reason: {
        type: "consent_stale",
        consentedVersionId: "god-group-notice@0.9",
        currentVersionId: "god-group-notice@1.1",
      },
    });
  });
});
