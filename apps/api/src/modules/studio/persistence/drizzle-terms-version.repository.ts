import { desc, eq } from "drizzle-orm";
import { campaignTermsVersions } from "../../campaign/persistence/schema/campaign.table";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { TermsVersionRecord, TermsVersionRepository } from "./terms-version.repository";

export class DrizzleTermsVersionRepository implements TermsVersionRepository {
  constructor(private readonly db: AppDb) {}

  async latestVersion(campaignId: string): Promise<number> {
    const [row] = await this.db
      .select({ version: campaignTermsVersions.version })
      .from(campaignTermsVersions)
      .where(eq(campaignTermsVersions.campaignId, campaignId))
      .orderBy(desc(campaignTermsVersions.version))
      .limit(1);
    return row?.version ?? 0;
  }

  async insert(record: TermsVersionRecord): Promise<void> {
    await this.db.insert(campaignTermsVersions).values({
      campaignId: record.campaignId,
      version: record.version,
      rewardPoints: record.rewardPoints,
      questionCount: record.questionCount,
      scoringRule: record.scoringRule,
      durationSeconds: record.durationSeconds,
      accuracyBonusPoints: record.accuracyBonusPoints,
      effectiveFrom: new Date(record.effectiveFrom),
    });
  }
}
