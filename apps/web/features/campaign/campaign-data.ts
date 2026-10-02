import "server-only";
// YT-0589: the enforcement this module's doc comment says does not exist.
// Importing this file from a client graph is now a BUILD FAILURE rather
// than a review catch. See apps/web/features/README-server-only.md.

import * as z from "zod";
import { campaignSchema, type Campaign } from "@yourtal/contracts/campaign";
import { apiFetch } from "@/lib/api/api-fetch";
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

/** The real catalogue, through the api (13.3.c: staging and production never read the mock). */
const liveDataSource: CampaignDataSource = {
  listCampaigns: async () => {
    const result = await apiFetch("/api/campaigns", campaignListSchema);
    if (!result.ok) throw new Error(`campaigns: ${result.error.message}`);
    return result.data.campaigns;
  },
  getCampaign: async (campaignId: string) => {
    const result = await apiFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}`,
      campaignSchema,
    );
    if (result.ok) return result.data;
    if (result.error.kind === "http" && result.error.status === 404) return undefined;
    throw new Error(`campaign ${campaignId}: ${result.error.message}`);
  },
};

const campaignListSchema = z.object({ campaigns: z.array(campaignSchema) });

const campaignDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

/** All campaigns for the earn board, unsorted and unfiltered. */
export function listCampaigns(): Promise<Campaign[]> {
  return campaignDataSource.listCampaigns();
}

/** A single campaign for the entry card, or `undefined` if no such campaign exists. */
export function getCampaign(campaignId: string): Promise<Campaign | undefined> {
  return campaignDataSource.getCampaign(campaignId);
}
