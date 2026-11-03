import type { BillingAllocation } from "@yourtal/contracts/billing";
import type { CampaignDraft } from "./campaign-draft";
import { apiDraftToWebDraft } from "./campaign-draft-live-mapping";
import type { ApiCampaignDraft } from "./campaign-draft-live-response";

export const LIVE_BUSINESS_ID = "00000000-0000-4000-8000-000000000603";

/** What the API returns for a draft: a fresh one with a placeholder length and nothing else filled in. */
export function liveApiDraft(overrides: Partial<ApiCampaignDraft> = {}): ApiCampaignDraft {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    businessId: LIVE_BUSINESS_ID,
    region: "AU",
    kind: "long_form",
    title: "Untitled campaign",
    synopsis: "",
    durationSeconds: 60,
    contentCategory: "entertainment",
    audience: "all_ages",
    lifecycleState: "draft",
    rejectionReason: null,
    startsAt: "2026-10-20T00:00:00.000Z",
    endsAt: "2026-11-20T00:00:00.000Z",
    openViewing: false,
    teaserStartSeconds: 0,
    posterFrameSeconds: null,
    declaredInterests: [],
    chapters: [],
    captionsUrl: null,
    posterUrl: null,
    teaserUrl: null,
    hlsUrl: null,
    rewardPoints: null,
    questionCount: null,
    scoringRule: null,
    publishedAt: null,
    targetDistricts: [],
    rewardConfig: null,
    ...overrides,
  };
}

/** The same draft as the editor holds it. */
export function liveDraft(overrides: Partial<ApiCampaignDraft> = {}): CampaignDraft {
  return apiDraftToWebDraft(liveApiDraft(overrides), "Snap App");
}

export function liveAllocation(overrides: Partial<BillingAllocation> = {}): BillingAllocation {
  return {
    allocationId: "alloc_biz:purchase-1",
    region: "AU",
    funderType: "partner",
    totalPoints: 50_000,
    remainingPoints: 48_800,
    programme: null,
    createdAt: "2026-10-21T04:05:00.000Z",
    ...overrides,
  } as BillingAllocation;
}
