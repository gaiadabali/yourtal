import { describe, expect, it } from "vitest";
import { campaignDraftFormResolver } from "./campaign-draft-form";
import type { CampaignDraftFormValues } from "./campaign-draft";

const VALID_VALUES: CampaignDraftFormValues = {
  title: "Launch",
  synopsis: "A short synopsis.",
  rewardPoints: 500,
  totalBudgetPoints: 100_000,
};

describe("campaignDraftFormResolver", () => {
  it("resolves with no errors for valid values, mirroring the plain validator", async () => {
    const result = await campaignDraftFormResolver(VALID_VALUES, undefined, {
      shouldUseNativeValidation: false,
      fields: {},
    });
    expect(result.errors).toStrictEqual({});
    expect(result.values).toBe(VALID_VALUES);
  });

  it("shapes a field error the way React Hook Form's FieldErrors expects", async () => {
    const invalid: CampaignDraftFormValues = { ...VALID_VALUES, title: "" };
    const result = await campaignDraftFormResolver(invalid, undefined, {
      shouldUseNativeValidation: false,
      fields: {},
    });
    expect(result.errors.title).toStrictEqual({
      type: "validate",
      message: "Give the campaign a title.",
    });
  });

  it("reports the same fields the underlying validator reports, nothing more", async () => {
    const invalid: CampaignDraftFormValues = { ...VALID_VALUES, rewardPoints: -1 };
    const result = await campaignDraftFormResolver(invalid, undefined, {
      shouldUseNativeValidation: false,
      fields: {},
    });
    expect(Object.keys(result.errors)).toStrictEqual(["rewardPoints"]);
  });
});
