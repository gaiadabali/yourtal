import { describe, expect, it } from "vitest";
import { getOnboardingCopy } from "@/features/onboarding/onboarding-copy";
import { getMeTranslator } from "./me-i18n";

/**
 * The brief: "the same purposes must appear here with the same names, or a
 * user cannot reconcile what they agreed to with what they can change."
 * This asserts it rather than hoping the two copy files were typed the same
 * way twice — same drift-guard technique as
 * `me-interest-option-lockstep.test.ts` and `features/region/region-config.test.ts`:
 * test code may import the read-only onboarding reference even though no
 * component here does.
 */
describe("features/me's consent titles stay in lockstep with onboarding's", () => {
  it.each(["en-AU", "id-ID"] as const)("matches for %s", (locale) => {
    const onboarding = getOnboardingCopy(locale).consent;
    const me = getMeTranslator(locale);
    expect(me("consent.personalizeTitle")).toBe(onboarding.personalize.title);
    expect(me("consent.marketingTitle")).toBe(onboarding.marketing.title);
  });
});
