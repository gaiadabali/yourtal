import type { CampaignFunderType } from "@yourtal/contracts/campaign/reward-config";

export interface RewardConfigRecord {
  readonly campaignId: string;
  readonly allocationId: string;
  readonly funderType: CampaignFunderType;
  readonly maxPointsForCampaign: number;
  readonly rewardPointsPerCompletion: number;
  readonly accuracyBonusPoints: number;
}

export interface RewardConfigRepository {
  /** Insert or replace — a campaign has at most one reward_config row (its own primary key). */
  upsert(input: RewardConfigRecord): Promise<RewardConfigRecord>;
  findByCampaignId(campaignId: string): Promise<RewardConfigRecord | null>;
}

export const REWARD_CONFIG_REPOSITORY = Symbol("REWARD_CONFIG_REPOSITORY");
