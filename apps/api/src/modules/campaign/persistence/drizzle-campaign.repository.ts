import { storedTagsOf } from "@yourtal/contracts/interest/tags";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Audience, Campaign } from "@yourtal/contracts/campaign";
import { campaignSchema } from "@yourtal/contracts/campaign";
import type { CampaignTerms } from "@yourtal/contracts/campaign/campaign-terms";
import { publicStatusOf, type CampaignLifecycleState } from "@yourtal/contracts/campaign/lifecycle";
import { toPoints } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
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

  async listVisible(
    limit: number,
    audiences?: readonly Audience[],
    region?: Region,
  ): Promise<Campaign[]> {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(
        and(
          inArray(campaigns.lifecycleState, VISIBLE_STATES),
          // 12.1.b: `undefined` (feed/search's own `fetchFundedCampaigns`
          // call, which filters downstream instead) or an empty list both
          // skip this filter entirely -- an empty `inArray` would otherwise
          // match nothing, which is "audiences" spelling "region_mismatch"
          // rather than an actual empty scope.
          audiences === undefined || audiences.length === 0
            ? undefined
            : inArray(campaigns.audience, audiences),
          // 12.1.f (F2): same "undefined skips it" shape as `audiences`
          // above -- `fetchFundedCampaigns` omits this too, for the same
          // reason.
          region === undefined ? undefined : eq(campaigns.region, region),
        ),
      )
      .orderBy(desc(campaigns.publishedAt))
      .limit(limit);

    const assembled = await this.assembleMany(rows);
    // A campaign that fails to parse is DROPPED from a list rather than
    // failing the whole request. One malformed row must not blank the Earn
    // board for everybody — but it is never silently repaired either: the
    // row simply does not appear, and `campaignSchema` is what decides.
    return assembled.filter((campaign): campaign is Campaign => campaign !== null);
  }

  async listVisibleByBusiness(
    businessId: string,
    limit: number,
    audiences?: readonly Audience[],
  ): Promise<Campaign[]> {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.businessId, businessId),
          inArray(campaigns.lifecycleState, VISIBLE_STATES),
          // 12.1.b: same audience filter `listVisible` uses, see that
          // method's own comment for why `undefined`/empty skips it.
          audiences === undefined || audiences.length === 0
            ? undefined
            : inArray(campaigns.audience, audiences),
        ),
      )
      .orderBy(desc(campaigns.publishedAt))
      .limit(limit);

    const assembled = await this.assembleMany(rows);
    return assembled.filter((campaign): campaign is Campaign => campaign !== null);
  }

  async findVisibleById(campaignId: string): Promise<Campaign | null> {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), inArray(campaigns.lifecycleState, VISIBLE_STATES)))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : ((await this.assembleMany([row]))[0] ?? null);
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
        and(
          eq(campaignTermsVersions.campaignId, campaignId),
          eq(campaignTermsVersions.version, version),
        ),
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

  /** 14.6.a: `rewardConfigFor` for many campaigns in one query (the feed asked once per candidate). */
  async rewardConfigsFor(
    campaignIds: readonly string[],
  ): Promise<ReadonlyMap<string, CampaignRewardConfigRow>> {
    if (campaignIds.length === 0) return new Map();
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
        FROM campaign.reward_config
       WHERE campaign_id IN (${sql.join(
         campaignIds.map((id) => sql`${id}`),
         sql`, `,
       )})
    `);
    return new Map(
      result.rows.map((row) => [
        row.campaign_id,
        {
          campaignId: row.campaign_id,
          allocationId: row.allocation_id,
          funderType: row.funder_type as CampaignRewardConfigRow["funderType"],
          maxPointsForCampaign: Number(row.max_points_for_campaign),
          rewardPointsPerCompletion: Number(row.reward_points_per_completion),
          accuracyBonusPoints: Number(row.accuracy_bonus_points),
        },
      ]),
    );
  }

  async targetDistrictsFor(
    campaignIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    if (campaignIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: campaigns.id, targetDistricts: campaigns.targetDistricts })
      .from(campaigns)
      .where(inArray(campaigns.id, [...campaignIds]));
    return new Map(rows.map((row) => [row.id, (row.targetDistricts as string[] | null) ?? []]));
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
  private async assembleMany(
    rows: readonly (typeof campaigns.$inferSelect)[],
  ): Promise<(Campaign | null)[]> {
    if (rows.length === 0) return [];
    // 14.6.a: two queries for the whole list, not two per campaign.
    const ids = rows.map((row) => row.id);
    const [chapterRows, videoSourceRows] = await Promise.all([
      this.db
        .select()
        .from(campaignChapters)
        .where(inArray(campaignChapters.campaignId, ids))
        .orderBy(asc(campaignChapters.ordinal)),
      this.db
        .select()
        .from(campaignVideoSources)
        .where(inArray(campaignVideoSources.campaignId, ids)),
    ]);
    const chaptersBy = new Map<string, (typeof chapterRows)[number][]>();
    for (const chapter of chapterRows) {
      const list = chaptersBy.get(chapter.campaignId);
      if (list === undefined) chaptersBy.set(chapter.campaignId, [chapter]);
      else list.push(chapter);
    }
    const videoSourceBy = new Map(videoSourceRows.map((source) => [source.campaignId, source]));
    return rows.map((row) =>
      this.assemble(row, chaptersBy.get(row.id) ?? [], videoSourceBy.get(row.id)),
    );
  }

  private assemble(
    row: typeof campaigns.$inferSelect,
    chapters: readonly (typeof campaignChapters.$inferSelect)[],
    videoSource: typeof campaignVideoSources.$inferSelect | undefined,
  ): Campaign | null {
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
      // TASKS.md 7.3 (20260927140000): published_at is nullable at the
      // column now (a draft/in_review campaign has none) -- this repository
      // only ever reads publicly-visible rows, which the database's own
      // campaigns_published_at_iff_live_or_past CHECK guarantees always
      // have one, but the column type no longer says so. Passed through as
      // `null` rather than asserted non-null: a row that broke that
      // guarantee should fail campaignSchema's parse below like any other
      // malformed row, not throw a TypeError first.
      publishedAt: row.publishedAt === null ? null : row.publishedAt.toISOString(),
      businessId: row.businessId,
      region: row.region,
      audience: row.audience,
      contentCategory: row.contentCategory,
      tags: storedTagsOf(row.declaredInterests),
      posterUrl: row.posterUrl,
      posterVariants: row.posterVariants,
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
        videoSource === undefined
          ? undefined
          : { kind: videoSource.kind, manifestUrl: videoSource.manifestUrl },
    });

    return parsed.success ? parsed.data : null;
  }
}
