import { describe, expect, it } from "vitest";
import {
  longMerchantNameCampaignFixture,
  zeroRewardCampaignFixture,
} from "@yourtal/contracts/campaign/mock";
import { listQuickCampaigns } from "./quick-data";

describe("listQuickCampaigns", () => {
  it("returns only campaigns of kind 'quick'", async () => {
    const campaigns = await listQuickCampaigns();
    expect(campaigns.length).toBeGreaterThan(0);
    for (const campaign of campaigns) {
      expect(campaign.kind).toBe("quick");
    }
  });

  it("never returns a campaign longer than 60 seconds, per the contract's own refinement", async () => {
    const campaigns = await listQuickCampaigns();
    for (const campaign of campaigns) {
      expect(campaign.durationSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("includes the long-merchant-name quick fixture, per the ticket's 'render them' instruction", async () => {
    const campaigns = await listQuickCampaigns();
    expect(campaigns.some((campaign) => campaign.id === longMerchantNameCampaignFixture.id)).toBe(
      true,
    );
  });

  it("excludes the zero-reward fixture, which is long_form and would violate the quick <=60s rule", async () => {
    const campaigns = await listQuickCampaigns();
    expect(campaigns.some((campaign) => campaign.id === zeroRewardCampaignFixture.id)).toBe(false);
  });
});
