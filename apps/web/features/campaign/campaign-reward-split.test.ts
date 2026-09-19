import { describe, expect, it } from "vitest";
import { longMerchantNameCampaignFixture, zeroRewardCampaignFixture } from "@yourtal/contracts/campaign/mock";
import { toPoints } from "@yourtal/contracts/money";
import { splitCampaignReward } from "./campaign-reward-split";

describe("splitCampaignReward", () => {
  it("puts the entire reward in the base amount when there is no accuracy bonus", () => {
    const split = splitCampaignReward({ ...zeroRewardCampaignFixture, scoringRule: "base_only", rewardPoints: toPoints(1_000) });
    expect(split.baseRewardPoints).toBe(1_000);
    expect(split.maxAccuracyBonusPoints).toBe(0);
  });

  it("splits 60/40 between base and accuracy bonus, never exceeding the advertised total", () => {
    const split = splitCampaignReward({
      ...zeroRewardCampaignFixture,
      scoringRule: "base_plus_accuracy_bonus",
      questionCount: 3,
      rewardPoints: toPoints(2_000),
    });
    expect(split.baseRewardPoints).toBe(1_200);
    expect(split.maxAccuracyBonusPoints).toBe(800);
    expect(split.baseRewardPoints + split.maxAccuracyBonusPoints).toBe(2_000);
  });

  it("never produces a negative bonus for the zero-reward fixture", () => {
    const split = splitCampaignReward({ ...zeroRewardCampaignFixture, scoringRule: "base_plus_accuracy_bonus", questionCount: 3 });
    expect(split.baseRewardPoints).toBe(0);
    expect(split.maxAccuracyBonusPoints).toBe(0);
  });

  it("handles the long-merchant-name fixture without throwing", () => {
    expect(() => splitCampaignReward(longMerchantNameCampaignFixture)).not.toThrow();
  });
});
