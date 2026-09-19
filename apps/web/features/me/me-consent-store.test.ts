import { beforeEach, describe, expect, it } from "vitest";
import {
  clearConsentPreferences,
  readConsentPreferences,
  writeConsentPreferences,
} from "./me-consent-store";
import { defaultConsentPreferences, withPurposeChanged } from "./me-consent";

const NOW = "2026-09-19T00:00:00.000Z";

describe("me-consent-store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to off-for-both-optional-purposes with no record at all", () => {
    expect(readConsentPreferences(NOW)).toEqual(defaultConsentPreferences(NOW));
  });

  it("seeds from the onboarding sign-up choice on first read, then persists it as the current record", () => {
    window.localStorage.setItem(
      "yourtal:onboarding-consent",
      JSON.stringify({
        essential: true,
        personalize: true,
        marketing: false,
        decidedAt: "2026-09-01T00:00:00.000Z",
      }),
    );

    const seeded = readConsentPreferences(NOW);
    expect(seeded).toEqual({
      essential: true,
      personalize: true,
      marketing: false,
      updatedAt: "2026-09-01T00:00:00.000Z",
    });

    // Persisted under this feature's own key, not re-derived from the seed every time.
    expect(window.localStorage.getItem("yourtal:me-consent")).not.toBeNull();
  });

  it("a change made here takes priority over the onboarding seed on the next read", () => {
    window.localStorage.setItem(
      "yourtal:onboarding-consent",
      JSON.stringify({
        essential: true,
        personalize: false,
        marketing: false,
        decidedAt: "2026-09-01T00:00:00.000Z",
      }),
    );
    const initial = readConsentPreferences(NOW);
    const changed = withPurposeChanged(initial, "marketing", true, "2026-09-19T01:00:00.000Z");
    writeConsentPreferences(changed);

    expect(readConsentPreferences(NOW)).toEqual(changed);
  });

  it("clearConsentPreferences removes the current record so a fresh read falls back to defaults", () => {
    writeConsentPreferences(
      withPurposeChanged(defaultConsentPreferences(NOW), "personalize", true, NOW),
    );
    clearConsentPreferences();
    expect(readConsentPreferences(NOW)).toEqual(defaultConsentPreferences(NOW));
  });

  it("a corrupt current record falls back to the seed, not a thrown error", () => {
    window.localStorage.setItem("yourtal:me-consent", "{not json");
    window.localStorage.setItem(
      "yourtal:onboarding-consent",
      JSON.stringify({
        essential: true,
        personalize: true,
        marketing: true,
        decidedAt: "2026-09-01T00:00:00.000Z",
      }),
    );
    expect(readConsentPreferences(NOW).personalize).toBe(true);
  });
});
