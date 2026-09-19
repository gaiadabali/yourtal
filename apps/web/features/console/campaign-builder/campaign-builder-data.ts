import { resolveDataSource } from "@yourtal/contracts/mock-source";
import type { CampaignDraft } from "./campaign-draft";
import { buildDemoCampaignDrafts } from "./campaign-draft-fixtures";

/**
 * The campaign builder's data-access seam, same shape and same reasoning as
 * `features/console/console-data.ts` (docs/tasks/phase-u-ui.md preamble:
 * "one switch flips every screen between mock and live"). Server-data-only
 * per docs/13b-typescript-standards.md §8: only `page.tsx` under
 * `app/(app)/business/campaigns/**` imports this module — the client leaf
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

const NOT_IMPLEMENTED_MESSAGE =
  "Live campaign builder data source is not implemented yet (Phase U is mock-only).";

const liveDataSource: CampaignBuilderDataSource = {
  listCampaignDrafts: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
};

const campaignBuilderDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

/** Every campaign draft belonging to one business, seeded once per business id so repeated navigation within a session sees the same demo set. */
export function listCampaignDrafts(
  businessId: string,
  merchantName: string,
): Promise<CampaignDraft[]> {
  return campaignBuilderDataSource.listCampaignDrafts(businessId, merchantName);
}
