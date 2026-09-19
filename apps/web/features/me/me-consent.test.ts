import { describe, expect, it } from "vitest";
import {
  consentPreferencesSchema,
  defaultConsentPreferences,
  parseOnboardingConsentChoice,
  withPurposeChanged,
} from "./me-consent";

describe("defaultConsentPreferences", () => {
  it("is off for both optional purposes and always-on for essential", () => {
    const prefs = defaultConsentPreferences("2026-09-19T00:00:00.000Z");
    expect(prefs).toEqual({
      essential: true,
      personalize: false,
      marketing: false,
      updatedAt: "2026-09-19T00:00:00.000Z",
    });
  });
});

describe("withPurposeChanged", () => {
  it("flips only the named purpose and updates the timestamp", () => {
    const before = defaultConsentPreferences("2026-01-01T00:00:00.000Z");
    const after = withPurposeChanged(before, "personalize", true, "2026-01-02T00:00:00.000Z");
    expect(after).toEqual({
      essential: true,
      personalize: true,
      marketing: false,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("withdrawing is the same shape as granting — no extra fields, no different result type", () => {
    const granted = withPurposeChanged(
      defaultConsentPreferences("2026-01-01T00:00:00.000Z"),
      "marketing",
      true,
      "2026-01-02T00:00:00.000Z",
    );
    const withdrawn = withPurposeChanged(granted, "marketing", false, "2026-01-03T00:00:00.000Z");
    expect(withdrawn.marketing).toBe(false);
    expect(Object.keys(withdrawn)).toEqual(Object.keys(granted));
  });
});

describe("parseOnboardingConsentChoice", () => {
  it("maps the onboarding local-store shape (decidedAt) onto ConsentPreferences (updatedAt)", () => {
    const parsed = parseOnboardingConsentChoice({
      essential: true,
      personalize: true,
      marketing: false,
      decidedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed).toEqual({
      essential: true,
      personalize: true,
      marketing: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rejects malformed input instead of guessing", () => {
    expect(parseOnboardingConsentChoice({ essential: false })).toBeNull();
    expect(parseOnboardingConsentChoice(null)).toBeNull();
    expect(parseOnboardingConsentChoice("not an object")).toBeNull();
  });
});

describe("consentPreferencesSchema", () => {
  it("round-trips a valid record", () => {
    const value = defaultConsentPreferences("2026-01-01T00:00:00.000Z");
    expect(consentPreferencesSchema.parse(value)).toEqual(value);
  });

  it("rejects essential: false — it is a literal true, never a togglable field", () => {
    const result = consentPreferencesSchema.safeParse({
      essential: false,
      personalize: false,
      marketing: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
