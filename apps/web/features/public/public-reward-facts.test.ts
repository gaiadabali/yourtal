import { describe, expect, it } from "vitest";
import {
  zeroRewardCampaignFixture,
  longMerchantNameCampaignFixture,
} from "@yourtal/contracts/campaign/mock";
import { soldOutListingFixture } from "@yourtal/contracts/listing/mock";
import { publicLocaleConfig } from "./public-locale";
import { computeCampaignRewardFacts, computeOfferRewardFacts } from "./public-reward-facts";

describe("computeCampaignRewardFacts", () => {
  it("names duration and reward together in the headline", () => {
    const facts = computeCampaignRewardFacts(
      longMerchantNameCampaignFixture,
      publicLocaleConfig("id"),
    );
    expect(facts.headline).toContain(facts.baseRewardLabel);
    expect(facts.headline).toContain(facts.durationLabel);
  });

  it("has no accuracy bonus for a base_only scoring rule", () => {
    const facts = computeCampaignRewardFacts(
      longMerchantNameCampaignFixture,
      publicLocaleConfig("id"),
    );
    expect(facts.accuracyBonusLabel).toBeNull();
  });

  it("never hides a zero reward — it states it plainly rather than omitting the row", () => {
    const facts = computeCampaignRewardFacts(zeroRewardCampaignFixture, publicLocaleConfig("id"));
    expect(facts.baseRewardLabel).toMatch(/0/);
    expect(facts.headline).toContain(facts.durationLabel);
  });
});

describe("computeOfferRewardFacts", () => {
  it("names the genuine face value and the points price together", () => {
    const facts = computeOfferRewardFacts(soldOutListingFixture, publicLocaleConfig("id"));
    expect(facts.headline).toContain(facts.worthLabel);
    expect(facts.headline).toContain(facts.pointsLabel);
    // The face value is the real Rp30.000 price, never the points-cost figure passed off as a currency amount.
    expect(facts.worthLabel).toMatch(/30\.000/);
  });
});
