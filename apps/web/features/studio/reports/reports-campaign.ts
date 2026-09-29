import type { CampaignScoringRule, CampaignStatus } from "@yourtal/contracts/campaign";

/**
 * The handful of a campaign's own fields the Reports zone actually reads
 * (`reports-campaign-overview-table.tsx`, `reports-metrics.ts`,
 * `reports-screen.tsx`) — never the full `@yourtal/contracts/campaign`
 * `Campaign` record, which this zone has no use for (chapters, video
 * source, poster/teaser URLs, region, audience, …).
 *
 * A real, published `Campaign` satisfies this interface structurally, so
 * `reports-fixtures.ts`'s mock rows (real `campaignSchema.parse` output)
 * still assign straight into `ReportsBundle.campaigns` unchanged. Live,
 * `reports-data.ts` builds one directly from `apps/api`'s studio draft
 * response (7.3.a) instead, which is NOT a full `Campaign` — the authoring
 * shape has no chapters/video/poster fields finalised until publish. This
 * narrower type is what makes both sources assignable to the one bundle
 * field without either lying about fields it does not really have.
 *
 * `status` is deliberately the VIEWER-facing `CampaignStatus`
 * (active/paused/ended), not the authoring `CampaignLifecycleState` — see
 * `@yourtal/contracts/campaign/lifecycle`'s own doc comment on why the two
 * are kept separate. A draft/in_review/rejected campaign has no public
 * status (`publicStatusOf` returns `undefined` for it) and is left out of
 * this zone's campaign list entirely, matching `reports-fixtures.ts`'s own
 * `CAMPAIGN_STATUS_CYCLE`, which never generates one either — a business
 * asks Reports "how did this perform", and a campaign that never (yet) ran
 * has nothing to report.
 */
export interface ReportsCampaign {
  readonly id: string;
  readonly title: string;
  readonly status: CampaignStatus;
  readonly questionCount: number;
  /** `null`: no reward config has been saved yet (7.3.h) — genuinely unset, never guessed at as `"base_only"`. */
  readonly scoringRule: CampaignScoringRule | null;
}
