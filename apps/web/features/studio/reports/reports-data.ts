import { z } from "zod";
import {
  campaignLifecycleStateSchema,
  publicStatusOf,
} from "@yourtal/contracts/campaign/lifecycle";
import { campaignScoringRuleSchema } from "@yourtal/contracts/campaign";
import { listingSchema } from "@yourtal/contracts/listing";
import type { Listing } from "@yourtal/contracts/listing";
import { resolveStudioDataSource } from "../studio-data-source";
import { questionSchema } from "@yourtal/contracts/question";
import type { Question } from "@yourtal/contracts/question";
import type { Voucher } from "@yourtal/contracts/voucher";
import { campaignReportResultSchema } from "@yourtal/contracts/report";
import type { CampaignReportResult } from "@yourtal/contracts/report";
import { toPoints } from "@yourtal/contracts/money";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ReportsCampaign } from "./reports-campaign";
import {
  buildCampaignFixtures,
  buildListingFixtures,
  buildQuestionFixtures,
  buildVoucherFixtures,
} from "./reports-fixtures";

/**
 * The Reports zone's data-access seam — same shape and same reasoning as
 * `studio-data.ts` (docs/tasks/phase-u-ui.md preamble: "one switch flips
 * every screen between mock and live"). Server-data-only per
 * docs/13b-typescript-standards.md §8: only `page.tsx` under
 * `app/(business)/studio/reports/**` and `reports-screen.tsx` import this
 * module.
 */
export interface ReportsBundle {
  campaigns: ReportsCampaign[];
  /** Keyed by `campaign.id`. A campaign with `questionCount: 0` has an empty array here, never a missing key. */
  questionsByCampaignId: Record<string, Question[]>;
  listings: Listing[];
  /**
   * `undefined`: a genuine structural gap, not a real zero — no
   * merchant-facing endpoint returns this business's own voucher ledger
   * broken down by status yet (`GET .../studio/redemptions`, 8.2.g, only
   * lists this business's own CAPTURE events — vouchers already redeemed at
   * one of its own devices — which is the separate Redemptions zone, not a
   * full ledger across every status). `reports-screen.tsx` renders an
   * honest gap panel instead of the ledger panel when this is `undefined`,
   * exactly the same "null means genuinely unavailable" reasoning
   * `CampaignReportResult`'s own `openViews` field documents. Flagged for
   * the architect (a new endpoint) rather than built here.
   */
  vouchers: Voucher[] | undefined;
}

interface ReportsDataSource {
  getReportsBundle: (businessId: string, businessDisplayName: string) => Promise<ReportsBundle>;
  /** `null` when the API has nothing for this campaign (not found, or not this business's own) — an honest gap, not an error toast. */
  getCampaignReport: (
    businessId: string,
    campaignId: string,
  ) => Promise<CampaignReportResult | null>;
}

const mockReportsDataSource: ReportsDataSource = {
  getReportsBundle: (businessId, businessDisplayName) => {
    const campaigns = buildCampaignFixtures({ businessId, businessDisplayName });
    const questionsByCampaignId: Record<string, Question[]> = {};
    for (const campaign of campaigns) {
      questionsByCampaignId[campaign.id] = buildQuestionFixtures(campaign);
    }
    const listings = buildListingFixtures({ businessId, businessDisplayName });
    const vouchers = buildVoucherFixtures({ businessId, businessDisplayName, listings });
    return Promise.resolve({ campaigns, questionsByCampaignId, listings, vouchers });
  },
  // A plausible-looking fixture, not a suppressed/gap state — mock mode has
  // no real cohort floor to trip, so showing real-shaped numbers here is
  // more useful for screen development than an always-suppressed stub.
  getCampaignReport: (_businessId, campaignId) =>
    Promise.resolve({
      campaignId,
      suppressed: false,
      rewardedViews: 1_240,
      completions: 860,
      completionRate: 860 / 1_240,
      averageWatchTimeSeconds: 96,
      questionAccuracy: 0.78,
      pointsSpent: toPoints(42_000),
      merchantVouchersRedeemed: 37,
      // 11.2.d: a plausible-looking number, same reasoning as the rest of
      // this fixture — mock mode has no real cohort floor to trip.
      openViews: 3_180,
    }),
};

/**
 * `apps/api`'s `CampaignDraftController` list response (7.3.a), restated —
 * a server can't import another app's types, same reasoning
 * `campaign-draft-live-response.ts` gives. Only the fields this zone
 * actually reads; see `reports-campaign.ts` for why a narrower type is
 * correct here rather than the full authoring shape.
 */
const apiCampaignSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  lifecycleState: z.string(),
  questionCount: z.number().nullable(),
  scoringRule: campaignScoringRuleSchema.nullable(),
});

/**
 * `null` for a campaign this zone has nothing to report on — draft,
 * in_review or rejected (`publicStatusOf` returns `undefined` for all
 * three), or an unrecognised lifecycle value this build predates. Never
 * throws on the latter: one campaign in an unexpected state should shrink
 * this zone's list by one row, not fail the whole page.
 */
function toReportsCampaign(api: z.infer<typeof apiCampaignSummarySchema>): ReportsCampaign | null {
  const parsedLifecycle = campaignLifecycleStateSchema.safeParse(api.lifecycleState);
  const status = parsedLifecycle.success ? publicStatusOf(parsedLifecycle.data) : undefined;
  if (status === undefined) return null;
  return {
    id: api.id,
    title: api.title,
    status,
    questionCount: api.questionCount ?? 0,
    scoringRule: api.scoringRule,
  };
}

/** `apps/api`'s `BankQuestionRecord` (`question-bank.controller.ts`) — only `.question` is read here; the bank's own status/PII/attempt-count fields are the question BANK editor's concern (`question-live-actions.ts`), not this zone's. */
const bankQuestionRecordSchema = z.object({ question: questionSchema });

const listingsResponseSchema = z.object({ listings: z.array(listingSchema) });

/**
 * Live: `GET /api/:tenantId/studio/campaigns` (7.3.a) for the campaign
 * list, `GET .../campaigns/:campaignId/questions` (7.3.b) per campaign for
 * its bank, and `GET .../store/listings` for this business's inventory —
 * every one of these already backs a DIFFERENT live Studio screen
 * (`campaign-builder-data.ts`, `question-bank-screen.tsx`,
 * `inventory-data.ts`), so this zone reads the same real rows those do,
 * restated through its own narrower schemas rather than importing another
 * feature's data module (each `*-data.ts` file stays self-contained, same
 * as `studio-data.ts`/`inventory-data.ts`/`campaign-builder-data.ts`).
 *
 * `getCampaignReport` is unchanged from before this pass — 7.6.a's real
 * endpoint was already fully wired, including the F12 cohort floor
 * suppression and the separately-floored `openViews` (11.2.d, 12.3.c).
 */
const liveReportsDataSource: ReportsDataSource = {
  getReportsBundle: async (businessId) => {
    const campaignsResult = await apiFetch(
      `/api/${businessId}/studio/campaigns`,
      z.array(apiCampaignSummarySchema),
    );
    if (!campaignsResult.ok) {
      throw new Error(`Could not load this business's campaigns: ${campaignsResult.error.message}`);
    }
    const campaigns = campaignsResult.data
      .map(toReportsCampaign)
      .filter((campaign): campaign is ReportsCampaign => campaign !== null);

    const questionsByCampaignId: Record<string, Question[]> = {};
    await Promise.all(
      campaigns.map(async (campaign) => {
        const result = await apiFetch(
          `/api/${businessId}/studio/campaigns/${campaign.id}/questions`,
          z.array(bankQuestionRecordSchema),
        );
        if (!result.ok) {
          throw new Error(
            `Could not load "${campaign.title}"'s question bank: ${result.error.message}`,
          );
        }
        questionsByCampaignId[campaign.id] = result.data.map((record) => record.question);
      }),
    );

    const listingsResult = await apiFetch(
      `/api/${businessId}/store/listings`,
      listingsResponseSchema,
    );
    if (!listingsResult.ok) {
      throw new Error(`Could not load this business's listings: ${listingsResult.error.message}`);
    }

    return {
      campaigns,
      questionsByCampaignId,
      listings: listingsResult.data.listings,
      // See `ReportsBundle.vouchers`'s own doc comment — a genuine gap,
      // never a fabricated empty ledger.
      vouchers: undefined,
    };
  },
  getCampaignReport: async (businessId, campaignId) => {
    const result = await apiFetch(
      `/api/${businessId}/studio/reports/campaigns/${campaignId}`,
      campaignReportResultSchema,
    );
    if (!result.ok) {
      if (result.error.kind === "http" && result.error.status === 404) return null;
      throw new Error(`Could not load the campaign report: ${result.error.message}`);
    }
    return result.data;
  },
};

const reportsDataSource = resolveStudioDataSource({
  mock: mockReportsDataSource,
  live: liveReportsDataSource,
});

/** Everything this business's Reports zone can honestly render today: its own campaigns, question banks and listings — plus its voucher ledger where a source for it exists (mock only today; see `ReportsBundle.vouchers`). */
export function getReportsBundle(
  businessId: string,
  businessDisplayName: string,
): Promise<ReportsBundle> {
  return reportsDataSource.getReportsBundle(businessId, businessDisplayName);
}

/** One campaign's real, server-computed performance report (7.6.a) — aggregates only, suppressed below the cohort floor. */
export function getCampaignReport(
  businessId: string,
  campaignId: string,
): Promise<CampaignReportResult | null> {
  return reportsDataSource.getCampaignReport(businessId, campaignId);
}
