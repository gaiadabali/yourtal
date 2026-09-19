import { describe, expect, it } from "vitest";
import type { Campaign } from "@yourtal/contracts/campaign";
import { zeroRewardCampaignFixture } from "@yourtal/contracts/campaign/mock";
import { CAMPAIGN_KIND_FILTER_VALUES, filterCampaignsByKind, isCampaignKindFilter } from "./campaign-filter";

const longForm: Campaign = { ...zeroRewardCampaignFixture, id: "11111111-1111-4111-8111-111111111111", kind: "long_form" };
const quick: Campaign = { ...zeroRewardCampaignFixture, id: "22222222-2222-4222-8222-222222222222", kind: "quick", durationSeconds: 30 };

describe("filterCampaignsByKind", () => {
  it("returns every campaign, unmutated order, for 'all'", () => {
    expect(filterCampaignsByKind([longForm, quick], "all")).toEqual([longForm, quick]);
  });

  it("keeps only long-form campaigns for 'long_form'", () => {
    expect(filterCampaignsByKind([longForm, quick], "long_form")).toEqual([longForm]);
  });

  it("keeps only quick campaigns for 'quick'", () => {
    expect(filterCampaignsByKind([longForm, quick], "quick")).toEqual([quick]);
  });

  it("does not mutate the input array", () => {
    const input = [longForm, quick];
    const copy = [...input];
    filterCampaignsByKind(input, "quick");
    expect(input).toEqual(copy);
  });
});

describe("isCampaignKindFilter", () => {
  it("accepts every declared filter value", () => {
    for (const value of CAMPAIGN_KIND_FILTER_VALUES) {
      expect(isCampaignKindFilter(value)).toBe(true);
    }
  });

  it("rejects an arbitrary string", () => {
    expect(isCampaignKindFilter("short_form")).toBe(false);
  });
});
