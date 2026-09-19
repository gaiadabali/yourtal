import { describe, expect, it } from "vitest";
import { campaignSchema } from "@yourtal/contracts/campaign";
import { mockCampaigns, zeroRewardCampaignFixture } from "@yourtal/contracts/campaign/mock";
import { getWatchCampaign } from "./get-watch-campaign";

describe("getWatchCampaign", () => {
  it("resolves a known mock-catalogue id to that exact campaign", () => {
    expect(getWatchCampaign(zeroRewardCampaignFixture.id)).toEqual(zeroRewardCampaignFixture);
    const first = mockCampaigns[0];
    if (first) {
      expect(getWatchCampaign(first.id)).toEqual(first);
    }
  });

  it("deterministically synthesizes a valid campaign for an unknown id, so a direct link never dead-ends", () => {
    const campaign = getWatchCampaign("some-unrouted-campaign-id");
    expect(() => campaignSchema.parse(campaign)).not.toThrow();
    expect(getWatchCampaign("some-unrouted-campaign-id")).toEqual(campaign);
  });

  it("gives different unknown ids different synthesized campaigns", () => {
    const a = getWatchCampaign("id-a");
    const b = getWatchCampaign("id-b");
    expect(a).not.toEqual(b);
  });
});
