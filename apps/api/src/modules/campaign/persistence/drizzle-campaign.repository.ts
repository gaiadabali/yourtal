import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Campaign } from "@yourtal/contracts/campaign";
import { campaignSchema } from "@yourtal/contracts/campaign";
import type { CampaignTerms } from "@yourtal/contracts/campaign/campaign-terms";
import { publicStatusOf, type CampaignLifecycleState } from "@yourtal/contracts/campaign/lifecycle";
import { toPoints } from "@yourtal/contracts/money";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { CampaignRepository, CampaignRewardConfigRow } from "./campaign.repository";
import {
  campaignChapters,
  campaignTermsVersions,
  campaignVideoSources,
  campaigns,
} from "./schema/campaign.table";

/** The three authoring states a viewer may see. The other three never leave here. */
const VISIBLE_STATES = ["live", "paused", "ended"];

export class DrizzleCampaignRepository implements CampaignRepository {
  constructor(private readonly db: AppDb) {}

  async listVisible(limit: number): Promise<Campaign[]> {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(inArray(campaigns.lifecycleState, VISIBLE_STATES))
      .orderBy(desc(campaigns.publishedAt))
      .limit(limit);

    const assembled = await Promise.all(rows.map((row) => this.assemble(row)));
    // A campaign that fails to parse is DROPPED from a list rather than
    // failing the whole request. One malformed row must not blank the Earn
    // board for everybody — but it is never silently repaired either: the
    // row simply does not appear, and `campaignSchema` is what decides.
    return assembled.filter((campaign): campaign is Campaign => campaign !== null);
  }

  async findVisibleById(campaignId: string): Promise<Campaign | null> {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), inArray(campaigns.lifecycleState, VISIBLE_STATES)))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : this.assemble(row);
  }

  async currentTermsVersion(campaignId: string): Promise<number | null> {
    const rows = await this.db
      .select({ version: campaignTermsVersions.version })
      .from(campaignTermsVersions)
      .where(eq(campaignTermsVersions.campaignId, campaignId))
      .orderBy(desc(campaignTermsVersions.version))
      .limit(1);
    return rows[0]?.version ?? null;
  }

  async isLive(campaignId: string): Promise<boolean> {
    const rows = await this.db
      .select({ state: campaigns.lifecycleState })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    // `live` only. A paused campaign stays VISIBLE so nobody watching it is
    // stranded, but it must not start paying again while paused.
    return rows[0]?.state === "live";
  }

  /** EW-20: read via the Drizzle table so a shape drift fails typecheck, not just at runtime. */
  async termsVersionDetails(campaignId: string, version: number): Promise<CampaignTerms | null> {
    const rows = await this.db
      .select()
      .from(campaignTermsVersions)
      .where(
        and(eq(campaignTermsVersions.campaignId, campaignId), eq(campaignTermsVersions.version, version)),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      campaignId: row.campaignId,
      version: row.version,
      rewardPoints: toPoints(row.rewardPoints),
      questionCount: row.questionCount,
      scoringRule: row.scoringRule as CampaignTerms["scoringRule"],
      durationSeconds: row.durationSeconds,
      accuracyBonusPoints: toPoints(row.accuracyBonusPoints),
      effectiveFrom: row.effectiveFrom.toISOString(),
    };
  }

  /**
   * Raw SQL rather than a Drizzle table: `campaign.reward_config` is owned
   * by 7.1 (studio, area C) and its Drizzle definition lives in
   * `campaign/persistence/schema/**`, which this session must not edit.
   * Reading it through `db.execute` needs no schema file of its own.
   */
  async rewardConfigFor(campaignId: string): Promise<CampaignRewardConfigRow | null> {
    const result = await this.db.execute<{
      campaign_id: string;
      allocation_id: string;
      funder_type: string;
      max_points_for_campaign: string;
      reward_points_per_completion: string;
      accuracy_bonus_points: string;
    }>(sql`
      SELECT campaign_id, allocation_id, funder_type, max_points_for_campaign,
             reward_points_per_completion, accuracy_bonus_points
        FROM campaign.reward_config WHERE campaign_id = ${campaignId}
    `);
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      campaignId: row.campaign_id,
      allocationId: row.allocation_id,
      funderType: row.funder_type as CampaignRewardConfigRow["funderType"],
      maxPointsForCampaign: Number(row.max_points_for_campaign),
      rewardPointsPerCompletion: Number(row.reward_points_per_completion),
      accuracyBonusPoints: Number(row.accuracy_bonus_points),
    };
  }

  /**
   * Builds the viewer-facing `Campaign` from its rows, and parses it.
   *
   * Parsed rather than cast. The database can produce a row this contract
   * rejects — a long-form campaign whose chapters failed to write, say — and
   * YT-0548 was exactly that situation going unnoticed for weeks because
   * nothing ever read a campaign back. `safeParse` here means the API cannot
   * serve a shape the contract forbids.
   */
  private async assemble(row: typeof campaigns.$inferSelect): Promise<Campaign | null> {
    const [chapters, videoSource] = await Promise.all([
      this.db
        .select()
        .from(campaignChapters)
        .where(eq(campaignChapters.campaignId, row.id))
        .orderBy(asc(campaignChapters.ordinal)),
      this.db
        .select()
        .from(campaignVideoSources)
        .where(eq(campaignVideoSources.campaignId, row.id))
        .limit(1),
    ]);

    const parsed = campaignSchema.safeParse({
      id: row.id,
      kind: row.kind,
      title: row.title,
      merchantId: row.merchantId,
      merchantName: row.merchantName,
      synopsis: row.synopsis,
      durationSeconds: row.durationSeconds,
      estimatedDataMb: Number(row.estimatedDataMb),
      rewardPoints: row.rewardPoints,
      questionCount: row.questionCount,
      scoringRule: row.scoringRule,
      // The one place the authoring state becomes a public one.
      status: publicStatusOf(row.lifecycleState as CampaignLifecycleState),
      publishedAt: row.publishedAt.toISOString(),
      businessId: row.businessId,
      region: row.region,
      audience: row.audience,
      contentCategory: row.contentCategory,
      posterUrl: row.posterUrl,
      teaserUrl: row.teaserUrl,
      hlsUrl: row.hlsUrl,
      captionsUrl: row.captionsUrl,
      aspect: row.aspect,
      estimatedBytes: row.estimatedBytes,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      openViewing: row.openViewing,
      teaserStartSeconds: row.teaserStartSeconds,
      chapters: chapters.map((chapter) => ({
        title: chapter.title,
        startSeconds: chapter.startSeconds,
        rewardWeight: Number(chapter.rewardWeight),
      })),
      videoSource:
        videoSource[0] === undefined
          ? undefined
          : { kind: videoSource[0].kind, manifestUrl: videoSource[0].manifestUrl },
    });

    return parsed.success ? parsed.data : null;
  }
}
