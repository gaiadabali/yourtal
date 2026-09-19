import type { Campaign } from "@yourtal/contracts/campaign";
import { longMerchantNameCampaignFixture, mockCampaigns } from "@yourtal/contracts/campaign/mock";
import { resolveDataSource } from "@yourtal/contracts/mock-source";

/**
 * The Quick feed's data-access seam (YT-0414), mirroring
 * `apps/web/features/campaign/campaign-data.ts`. Server-data-only per
 * docs/13b-typescript-standards.md §8: only `page.tsx` (a Server Component)
 * imports this module — no `"use client"` file under `features/quick`
 * reaches it, which is what keeps the ~96 KB gz Zod runtime that
 * `@yourtal/contracts/campaign/mock` pulls in out of this route's client
 * bundle (§8's 170 KB gate — see `apps/web/features/campaign/campaign-filter.ts`
 * for the exact mistake this boundary guards against).
 *
 * Filtered to `campaign.kind === "quick"`, a plain string comparison
 * against the `Campaign` type (an `import type`, erased at compile time),
 * never `campaignKindSchema`'s value export. Moot for bundle size here
 * since this whole module is server-only, but kept in the same
 * value-import-free style used everywhere else in this codebase so the
 * pattern never has to be re-learned when code moves.
 *
 * `zeroRewardCampaignFixture` is deliberately NOT included here: it is a
 * `long_form` fixture (600s), and `campaignSchema`'s own `.refine` forbids
 * a `quick` campaign longer than 60s (`campaign.ts`) — forcing it into this
 * feed would either violate the schema or misrepresent the fixture.
 * `longMerchantNameCampaignFixture` IS a genuine `quick` fixture (30s) and
 * is included, per the ticket's "render them; they are built to break
 * layouts."
 */
const mockQuickCampaigns: Campaign[] = [...mockCampaigns, longMerchantNameCampaignFixture].filter(
  (campaign) => campaign.kind === "quick",
);

interface QuickCampaignDataSource {
  listQuickCampaigns: () => Promise<Campaign[]>;
}

const mockDataSource: QuickCampaignDataSource = {
  listQuickCampaigns: () => Promise.resolve(mockQuickCampaigns),
};

/**
 * No BFF exists yet — this whole phase builds against typed mock fixtures
 * (docs/tasks/phase-u-ui.md preamble). Fails loudly and specifically rather
 * than silently serving mock data under a "live" flag, so flipping
 * `YOURTAL_DATA_SOURCE=live` demonstrates this route's `error.tsx` honestly
 * instead of faking a failure for a demo — see `campaign-data.ts`'s
 * identical rationale.
 */
const liveDataSource: QuickCampaignDataSource = {
  listQuickCampaigns: () =>
    Promise.reject(
      new Error("Live quick campaign data source is not implemented yet (Phase U is mock-only)."),
    ),
};

const quickCampaignDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

/** All quick (<=60s, points-only) campaigns for the Quick feed, unsorted. */
export function listQuickCampaigns(): Promise<Campaign[]> {
  return quickCampaignDataSource.listQuickCampaigns();
}
