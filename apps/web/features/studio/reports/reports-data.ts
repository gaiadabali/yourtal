import type { Campaign } from "@yourtal/contracts/campaign";
import type { Listing } from "@yourtal/contracts/listing";
import { resolveStudioDataSource } from "../studio-data-source";
import type { Question } from "@yourtal/contracts/question";
import type { Voucher } from "@yourtal/contracts/voucher";
import { campaignReportResultSchema } from "@yourtal/contracts/report";
import type { CampaignReportResult } from "@yourtal/contracts/report";
import { toPoints } from "@yourtal/contracts/money";
import { apiFetch } from "@/lib/api/api-fetch";
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
  campaigns: Campaign[];
  /** Keyed by `campaign.id`. A campaign with `questionCount: 0` has an empty array here, never a missing key. */
  questionsByCampaignId: Record<string, Question[]>;
  listings: Listing[];
  vouchers: Voucher[];
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
    }),
};

const NOT_IMPLEMENTED_MESSAGE =
  "Live business reports data source is not implemented yet (Phase U is mock-only) — and unlike other console zones, there is also no history/analytics event contract in packages/contracts for it to read from yet. See YT-0443's report.";

/**
 * Fails loudly and specifically rather than silently falling back to mock
 * data under a "live" flag — see `studio-data.ts`/`store-data.ts` for the
 * same reasoning. `getCampaignReport` is the one exception: 7.6's real
 * endpoint exists, so it is genuinely wired, while the rest of the bundle
 * (campaign listing, question banks, vouchers) still has no live source —
 * `reports-screen.tsx` shows those as honest gaps via
 * `reports-unavailable-metrics.ts` once 7.3's real campaign listing lands.
 */
const liveReportsDataSource: ReportsDataSource = {
  getReportsBundle: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
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

/** Everything this business's Reports zone can honestly render today: its own campaigns, question banks, listings and voucher ledger. */
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
