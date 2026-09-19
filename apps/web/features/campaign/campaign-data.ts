import type { Campaign } from "@yourtal/contracts/campaign";
import {
  longMerchantNameCampaignFixture,
  mockCampaigns,
  zeroRewardCampaignFixture,
} from "@yourtal/contracts/campaign/mock";
import { resolveDataSource } from "@yourtal/contracts/mock-source";

/**
 * The earn board and entry card's single data-access seam
 * (docs/tasks/phase-u-ui.md preamble: "one switch flips every screen
 * between mock and live"). Server-data-only per
 * docs/13b-typescript-standards.md §8: only `page.tsx` Server Components
 * import this module. It is not marked with the `server-only` package
 * because that package is not in this workspace's installed dependencies
 * and this task may not run `pnpm install` — the boundary is enforced by
 * review instead (no `"use client"` file in this feature imports it).
 *
 * The awkward fixtures (`zeroRewardCampaignFixture`,
 * `longMerchantNameCampaignFixture`) are folded into the catalogue rather
 * than kept test-only, so a manual pass at 320px sees them on the real
 * board too, per the brief: "use them."
 */
const mockCampaignCatalogue: Campaign[] = [
  ...mockCampaigns,
  zeroRewardCampaignFixture,
  longMerchantNameCampaignFixture,
];

interface CampaignDataSource {
  listCampaigns: () => Promise<Campaign[]>;
  getCampaign: (campaignId: string) => Promise<Campaign | undefined>;
}

const mockDataSource: CampaignDataSource = {
  listCampaigns: () => Promise.resolve(mockCampaignCatalogue),
  getCampaign: (campaignId: string) =>
    Promise.resolve(mockCampaignCatalogue.find((campaign) => campaign.id === campaignId)),
};

/**
 * No BFF exists yet (this whole phase builds against typed mock fixtures —
 * see the phase-u-ui.md preamble). Rather than silently returning mock data
 * under a "live" flag, the live implementation fails loudly and specifically,
 * so flipping `YOURTAL_DATA_SOURCE=live` today demonstrates this route's
 * `error.tsx` honestly instead of faking a failure for a demo.
 */
const liveDataSource: CampaignDataSource = {
  listCampaigns: () =>
    Promise.reject(
      new Error("Live campaign data source is not implemented yet (Phase U is mock-only)."),
    ),
  getCampaign: () =>
    Promise.reject(
      new Error("Live campaign data source is not implemented yet (Phase U is mock-only)."),
    ),
};

const campaignDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

/** All campaigns for the earn board, unsorted and unfiltered. */
export function listCampaigns(): Promise<Campaign[]> {
  return campaignDataSource.listCampaigns();
}

/** A single campaign for the entry card, or `undefined` if no such campaign exists. */
export function getCampaign(campaignId: string): Promise<Campaign | undefined> {
  return campaignDataSource.getCampaign(campaignId);
}
