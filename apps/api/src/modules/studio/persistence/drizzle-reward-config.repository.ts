import { eq } from "drizzle-orm";
import { campaignRewardConfigs } from "../../campaign/persistence/schema/campaign.table";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { RewardConfigRecord, RewardConfigRepository } from "./reward-config.repository";

export class DrizzleRewardConfigRepository implements RewardConfigRepository {
  constructor(private readonly db: AppDb) {}

  async upsert(input: RewardConfigRecord): Promise<RewardConfigRecord> {
    const [row] = await this.db
      .insert(campaignRewardConfigs)
      .values(input)
      .onConflictDoUpdate({
        target: campaignRewardConfigs.campaignId,
        set: {
          allocationId: input.allocationId,
          funderType: input.funderType,
          maxPointsForCampaign: input.maxPointsForCampaign,
          rewardPointsPerCompletion: input.rewardPointsPerCompletion,
          accuracyBonusPoints: input.accuracyBonusPoints,
        },
      })
      .returning();
    if (row === undefined) {
      throw new Error("insert into campaign.reward_config returned no row");
    }
    return toDomain(row);
  }

  async findByCampaignId(campaignId: string): Promise<RewardConfigRecord | null> {
    const [row] = await this.db
      .select()
      .from(campaignRewardConfigs)
      .where(eq(campaignRewardConfigs.campaignId, campaignId))
      .limit(1);
    return row === undefined ? null : toDomain(row);
  }
}

function toDomain(row: typeof campaignRewardConfigs.$inferSelect): RewardConfigRecord {
  return {
    campaignId: row.campaignId,
    allocationId: row.allocationId,
    funderType: row.funderType as RewardConfigRecord["funderType"],
    maxPointsForCampaign: row.maxPointsForCampaign,
    rewardPointsPerCompletion: row.rewardPointsPerCompletion,
    accuracyBonusPoints: row.accuracyBonusPoints,
  };
}
