import type { Campaign } from "@yourtal/contracts/campaign";
import type { Points } from "@yourtal/contracts/money";
import { subtractPointsClamped, toPoints } from "@yourtal/contracts/money";

/**
 * Splits a campaign's advertised reward into the base amount and the
 * maximum accuracy bonus on top of it — the entry-card contract screen
 * (YT-0411) must never combine these into one inflated headline number.
 *
 * docs/06-longform-video-and-attention.md §4.2 states the policy this mocks:
 * "base 60% of advertised value for completing and answering + up to 40%
 * more for accuracy". The real split is a per-campaign business setting
 * that will live in the pricing engine once it exists (docs/09); this ratio
 * is the documented placeholder for mock data and is not a new contract
 * field, so it is kept in `apps/web`, not `packages/contracts`.
 */
const BASE_REWARD_RATIO = 0.6;

export interface CampaignRewardSplit {
  /** Paid for watching and answering, regardless of correctness. */
  baseRewardPoints: Points;
  /** The most accuracy can add on top of the base reward. Zero when the campaign has no accuracy bonus. */
  maxAccuracyBonusPoints: Points;
}

export function splitCampaignReward(campaign: Campaign): CampaignRewardSplit {
  if (campaign.scoringRule === "base_only") {
    return { baseRewardPoints: campaign.rewardPoints, maxAccuracyBonusPoints: toPoints(0) };
  }

  const baseRewardPoints = toPoints(Math.round(campaign.rewardPoints * BASE_REWARD_RATIO));
  const maxAccuracyBonusPoints = subtractPointsClamped(campaign.rewardPoints, baseRewardPoints);
  return { baseRewardPoints, maxAccuracyBonusPoints };
}
