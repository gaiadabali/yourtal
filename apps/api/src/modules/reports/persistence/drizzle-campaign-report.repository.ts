import { sql } from "drizzle-orm";
import { audienceSchema } from "@yourtal/contracts/audience/audience";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type {
  CampaignReportRepository,
  QuestionAggregates,
  ReportedCampaign,
  SessionAggregates,
} from "./campaign-report.repository";

/**
 * Raw `sql` throughout, deliberately not the campaign/watch modules' own
 * Drizzle table objects: 7.3 (campaign authoring) is being built
 * concurrently in a sibling worktree and is likely to add its own table
 * definitions for `campaign.question` any moment. A raw query against a
 * column name is exactly as correct as a typed one and creates no shared
 * file for two sessions to collide on.
 */
export class DrizzleCampaignReportRepository implements CampaignReportRepository {
  constructor(private readonly db: AppDb) {}

  async findOwnedCampaign(
    businessId: string,
    campaignId: string,
  ): Promise<ReportedCampaign | null> {
    const result = await this.db.execute<{ audience: string }>(sql`
      SELECT audience FROM campaign.campaigns
       WHERE id = ${campaignId} AND business_id = ${businessId}
    `);
    const row = result.rows[0];
    if (row === undefined) return null;
    return { campaignId, audience: audienceSchema.parse(row.audience) };
  }

  async sessionAggregates(campaignId: string): Promise<SessionAggregates> {
    const result = await this.db.execute<{
      rewarded_views: string;
      completions: string;
      average_watch_seconds: string | null;
    }>(sql`
      SELECT
        count(*) AS rewarded_views,
        count(*) FILTER (WHERE completed_at IS NOT NULL) AS completions,
        avg(EXTRACT(epoch FROM (completed_at - started_at)))
          FILTER (WHERE completed_at IS NOT NULL) AS average_watch_seconds
        FROM watch.session
       WHERE campaign_id = ${campaignId}
    `);
    const row = result.rows[0];
    return {
      rewardedViews: Number(row?.rewarded_views ?? 0),
      completions: Number(row?.completions ?? 0),
      averageWatchTimeSeconds:
        row?.average_watch_seconds === null || row?.average_watch_seconds === undefined
          ? null
          : Number(row.average_watch_seconds),
    };
  }

  async questionAggregates(campaignId: string): Promise<QuestionAggregates | null> {
    const result = await this.db.execute<{ times_asked: string; times_correct: string }>(sql`
      SELECT COALESCE(SUM(times_asked), 0) AS times_asked,
             COALESCE(SUM(times_correct), 0) AS times_correct
        FROM campaign.question
       WHERE campaign_id = ${campaignId}
    `);
    const row = result.rows[0];
    const timesAsked = Number(row?.times_asked ?? 0);
    if (timesAsked === 0) return null;
    return { timesAsked, timesCorrect: Number(row?.times_correct ?? 0) };
  }
}
