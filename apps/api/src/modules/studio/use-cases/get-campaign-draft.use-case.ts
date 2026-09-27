import { errAsync, ResultAsync } from "neverthrow";
import type {
  CampaignDraft,
  CampaignDraftRepository,
} from "../persistence/campaign-draft.repository";
import type { GetCampaignDraftError, ListCampaignDraftsError } from "../studio.errors";

export function getCampaignDraft(
  drafts: CampaignDraftRepository,
  businessId: string,
  campaignId: string,
): ResultAsync<CampaignDraft, GetCampaignDraftError> {
  return ResultAsync.fromPromise(
    drafts.findById(businessId, campaignId),
    (cause): GetCampaignDraftError => ({ type: "persistence_failed", cause: String(cause) }),
  ).andThen((draft) =>
    draft === null
      ? errAsync<CampaignDraft, GetCampaignDraftError>({ type: "campaign_not_found", campaignId })
      : ResultAsync.fromSafePromise(Promise.resolve(draft)),
  );
}

export function listCampaignDrafts(
  drafts: CampaignDraftRepository,
  businessId: string,
): ResultAsync<readonly CampaignDraft[], ListCampaignDraftsError> {
  return ResultAsync.fromPromise(
    drafts.listByBusiness(businessId),
    (cause): ListCampaignDraftsError => ({ type: "persistence_failed", cause: String(cause) }),
  );
}
