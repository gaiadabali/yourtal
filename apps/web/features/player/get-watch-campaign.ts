import "server-only";

import type { Campaign } from "@yourtal/contracts/campaign";
import { campaignSchema } from "@yourtal/contracts/campaign";
import type { CampaignTerms } from "@yourtal/contracts/campaign/terms";
import { campaignTermsSchema } from "@yourtal/contracts/campaign/terms";
import { apiFetch } from "@/lib/api/api-fetch";

export interface WatchCampaign {
  readonly campaign: Campaign;
  readonly terms: CampaignTerms;
}

/**
 * Data access for the watch route (RSC-safe — called only from
 * `page.tsx`'s Server Component, never from a client leaf). Phase 11 (11.5)
 * replaces the mock-only version this file used to carry: the campaign page
 * is a real BFF read now (`GET /api/campaigns/:id` and its terms sibling,
 * 11.5.a), same convention as `feed-data.ts`.
 *
 * `null` for "no such campaign, or not public, or no published terms" —
 * `page.tsx` turns that into a 404 rather than distinguishing the three,
 * for the same disclosure reason `CampaignController.get` already gives.
 */
export async function getWatchCampaign(campaignId: string): Promise<WatchCampaign | null> {
  const campaignRead = await apiFetch(`/api/campaigns/${campaignId}`, campaignSchema);
  if (!campaignRead.ok) {
    return null;
  }
  const termsRead = await apiFetch(`/api/campaigns/${campaignId}/terms`, campaignTermsSchema);
  if (!termsRead.ok) {
    return null;
  }
  return { campaign: campaignRead.data, terms: termsRead.data };
}
