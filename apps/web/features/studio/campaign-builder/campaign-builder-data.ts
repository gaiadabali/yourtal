import { z } from "zod";
import { resolveStudioDataSource } from "../studio-data-source";
import { apiFetch } from "@/lib/api/api-fetch";
import type { CampaignDraft } from "./campaign-draft";
import { buildDemoCampaignDrafts } from "./campaign-draft-fixtures";
import { apiCampaignDraftSchema, apiDraftToWebDraft } from "./campaign-draft-live-mapping";

/**
 * The campaign builder's data-access seam, same shape and same reasoning as
 * `features/studio/studio-data.ts` (docs/tasks/phase-u-ui.md preamble:
 * "one switch flips every screen between mock and live"). Server-data-only
 * per docs/13b-typescript-standards.md §8: only `page.tsx` under
 * `app/(business)/studio/campaigns/**` imports this module — the client leaf
 * (`campaign-builder-screen.tsx`) receives the resolved list as a prop and
 * holds its own edits in `useState`, the same pattern `TeamScreen` uses.
 */
interface CampaignBuilderDataSource {
  listCampaignDrafts: (businessId: string, merchantName: string) => Promise<CampaignDraft[]>;
}

const draftsByBusiness = new Map<string, CampaignDraft[]>();

const mockDataSource: CampaignBuilderDataSource = {
  listCampaignDrafts: (businessId, merchantName) => {
    const existing = draftsByBusiness.get(businessId);
    if (existing) {
      return Promise.resolve(existing);
    }
    const seeded = buildDemoCampaignDrafts(businessId, merchantName);
    draftsByBusiness.set(businessId, seeded);
    return Promise.resolve(seeded);
  },
};

/**
 * Live: `GET /api/:tenantId/studio/campaigns` (7.3.a, merged to `main`).
 * Mapped through `apiDraftToWebDraft` — see `campaign-draft-live-mapping.ts`'s
 * own doc comment for exactly which fields do not round-trip yet
 * (targeting.districts, budget, question bank, the reward split).
 */
const liveDataSource: CampaignBuilderDataSource = {
  listCampaignDrafts: async (businessId, merchantName) => {
    const result = await apiFetch(
      `/api/${businessId}/studio/campaigns`,
      z.array(apiCampaignDraftSchema),
    );
    if (!result.ok) throw new Error(`Could not load campaign drafts: ${result.error.message}`);
    return result.data.map((draft) => apiDraftToWebDraft(draft, merchantName));
  },
};

const campaignBuilderDataSource = resolveStudioDataSource({
  mock: mockDataSource,
  live: liveDataSource,
});

/** Every campaign draft belonging to one business, seeded once per business id so repeated navigation within a session sees the same demo set. */
export function listCampaignDrafts(
  businessId: string,
  merchantName: string,
): Promise<CampaignDraft[]> {
  return campaignBuilderDataSource.listCampaignDrafts(businessId, merchantName);
}
