import type { Campaign } from "@yourtal/contracts/campaign";
import type { Listing } from "@yourtal/contracts/listing";
import { resolveDataSource } from "@yourtal/contracts/mock-source";
import type { Question } from "@yourtal/contracts/question";
import type { Voucher } from "@yourtal/contracts/voucher";
import {
  buildCampaignFixtures,
  buildListingFixtures,
  buildQuestionFixtures,
  buildVoucherFixtures,
} from "./reports-fixtures";

/**
 * The Reports zone's data-access seam — same shape and same reasoning as
 * `console-data.ts` (docs/tasks/phase-u-ui.md preamble: "one switch flips
 * every screen between mock and live"). Server-data-only per
 * docs/13b-typescript-standards.md §8: only `page.tsx` under
 * `app/(app)/business/reports/**` and `reports-screen.tsx` import this
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
};

const NOT_IMPLEMENTED_MESSAGE =
  "Live business reports data source is not implemented yet (Phase U is mock-only) — and unlike other console zones, there is also no history/analytics event contract in packages/contracts for it to read from yet. See YT-0443's report.";

/**
 * Fails loudly and specifically rather than silently falling back to mock
 * data under a "live" flag — see `console-data.ts`/`store-data.ts` for the
 * same reasoning.
 */
const liveReportsDataSource: ReportsDataSource = {
  getReportsBundle: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
};

const reportsDataSource = resolveDataSource({
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
