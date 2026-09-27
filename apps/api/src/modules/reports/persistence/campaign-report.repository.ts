import type { Audience } from "@yourtal/contracts/audience/audience";

/** 7.6: read-only aggregates against campaign/watch tables. No write method -- Reports never writes anything. */

export interface ReportedCampaign {
  readonly campaignId: string;
  readonly audience: Audience;
}

export interface SessionAggregates {
  readonly rewardedViews: number;
  readonly completions: number;
  /** `null` when `completions` is 0 -- nothing to average. */
  readonly averageWatchTimeSeconds: number | null;
}

export interface QuestionAggregates {
  readonly timesAsked: number;
  readonly timesCorrect: number;
}

export interface CampaignReportRepository {
  /** `null` if no campaign with this id belongs to this business. */
  findOwnedCampaign(businessId: string, campaignId: string): Promise<ReportedCampaign | null>;
  sessionAggregates(campaignId: string): Promise<SessionAggregates>;
  /** `null` if this campaign has no questions at all. */
  questionAggregates(campaignId: string): Promise<QuestionAggregates | null>;
}

export const CAMPAIGN_REPORT_REPOSITORY = Symbol("CAMPAIGN_REPORT_REPOSITORY");
