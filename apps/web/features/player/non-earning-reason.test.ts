import { describe, expect, it } from "vitest";
import { identityCheckKey, nonEarningReasonKey } from "./non-earning-reason";
import { getPlayerTranslator } from "./player-i18n";

describe("nonEarningReasonKey", () => {
  it.each([
    ["This campaign has given out all its rewards.", "campaignCapReached"],
    [
      "This campaign has given out today's rewards. You can earn from it again tomorrow.",
      "campaignDailyCapReached",
    ],
    ["already_earned", "alreadyEarned"],
    ["no_funding_configured", "noFunding"],
    ["identity_check_required", "identityCheck"],
    ["Rewards are paused right now.", "paused"],
  ])("maps %s", (reason, key) => {
    expect(nonEarningReasonKey(reason)).toBe(key);
  });

  it("falls back to the generic line for null or unknown text, never raw API text", () => {
    expect(nonEarningReasonKey(null)).toBe("generic");
    expect(nonEarningReasonKey("something new")).toBe("generic");
    expect(nonEarningReasonKey("toString")).toBe("generic");
  });

  it("asks to verify unless the only step left is a permanent email", () => {
    expect(identityCheckKey(undefined)).toBe("identityCheck");
    expect(identityCheckKey([])).toBe("identityCheck");
    expect(identityCheckKey(["verify_email"])).toBe("identityCheck");
    expect(identityCheckKey(["verify_email", "use_permanent_email"])).toBe("identityCheck");
    expect(identityCheckKey(["use_permanent_email"])).toBe("identityCheckPermanentEmail");
  });

  it("has a real line in both catalogues for every key", () => {
    for (const locale of ["en-AU", "id-ID"] as const) {
      const t = getPlayerTranslator(locale);
      for (const key of [
        "campaignCapReached",
        "campaignDailyCapReached",
        "identityCheck",
        "identityCheckPermanentEmail",
        "generic",
      ] as const) {
        expect(t(`refusal.reasons.${key}`)).not.toContain("refusal.reasons");
      }
    }
    expect(getPlayerTranslator("id-ID")("refusal.reasons.campaignCapReached")).toBe(
      "Kampanye ini sudah membagikan semua reward-nya.",
    );
  });
});
