import type { CampaignScoringRule } from "@yourtal/contracts/campaign";

export interface TermsVersionRecord {
  readonly campaignId: string;
  readonly version: number;
  readonly rewardPoints: number;
  readonly questionCount: number;
  readonly scoringRule: CampaignScoringRule;
  readonly durationSeconds: number;
  readonly accuracyBonusPoints: number;
  readonly effectiveFrom: string;
}

export interface TermsVersionRepository {
  /** 0 when the campaign has never had a version — insert starts at 1. */
  latestVersion(campaignId: string): Promise<number>;
  /** Insert-only (`campaign.terms_version` grants no UPDATE/DELETE to yourtal_app) -- a frozen promise, never rewritten. */
  insert(record: TermsVersionRecord): Promise<void>;
}

export const TERMS_VERSION_REPOSITORY = Symbol("TERMS_VERSION_REPOSITORY");
