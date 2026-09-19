import { describe, expect, it } from "vitest";
import { getOnboardingCopy } from "./onboarding-copy";

describe("getOnboardingCopy", () => {
  it("returns distinct English copy for en-AU and Indonesian copy for id-ID", () => {
    const en = getOnboardingCopy("en-AU");
    const id = getOnboardingCopy("id-ID");

    expect(en.consent.heading).toBe("Before we continue");
    expect(id.consent.heading).toBe("Sebelum lanjut");
    expect(en.verify.phoneHeading).not.toBe(id.verify.phoneHeading);
  });

  it("never overclaims what the OTP proves, in either language", () => {
    // docs/23-critique.md section 1.0: phone OTP is a de-duplication check,
    // not identity proof. Both locales' disclaimer must say so explicitly,
    // and neither may claim the number or the person is "verified" as fact
    // beyond the narrow "hasn't signed up before" claim.
    for (const locale of ["en-AU", "id-ID"] as const) {
      const copy = getOnboardingCopy(locale);
      expect(copy.verify.otpDisclaimer.toLowerCase()).toMatch(/before|belum pernah/);
    }
  });

  it("marks the OTP flow as a prototype rather than implying real SMS delivery", () => {
    for (const locale of ["en-AU", "id-ID"] as const) {
      const copy = getOnboardingCopy(locale);
      expect(copy.verify.demoCodeHint.length).toBeGreaterThan(0);
    }
  });

  it("has no empty string anywhere in either bundle", () => {
    for (const locale of ["en-AU", "id-ID"] as const) {
      const copy = getOnboardingCopy(locale);
      const values = collectStrings(copy);
      expect(values.length).toBeGreaterThan(0);
      expect(values.every((value) => value.trim().length > 0)).toBe(true);
    }
  });
});

/**
 * Walks an arbitrarily-nested object of strings (the exact shape of
 * `OnboardingCopy`) without ever widening to `any` — `Object.values` on a
 * bare `object` returns `any[]` in TypeScript's lib types, which the
 * type-aware lint rules in eslint.config.mjs (13b section 2) reject. Takes
 * `unknown` rather than `OnboardingCopy` itself so it also works for any
 * nested purpose-copy shape without a second overload.
 */
function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([, nested]) =>
      collectStrings(nested),
    );
  }
  return [];
}
