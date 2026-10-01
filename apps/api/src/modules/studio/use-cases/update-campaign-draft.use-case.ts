import { errAsync, ResultAsync } from "neverthrow";
import type {
  CampaignDraft,
  CampaignDraftRepository,
  UpdateCampaignDraftInput,
} from "../persistence/campaign-draft.repository";
import type { UpdateCampaignDraftError } from "../studio.errors";
import { categoryRefusal, openViewingRefusal } from "./category-policy";

/**
 * TASKS.md 7.3.a: "an advertiser edits freely until they submit" (docs/17) —
 * refused once the campaign has left `draft`. A category/audience change is
 * re-checked against the SAME 1.1.d policy create uses, since a business
 * could otherwise author an ordinary category and edit it into a prohibited
 * one after the fact.
 */
export function updateCampaignDraft(
  drafts: CampaignDraftRepository,
  businessId: string,
  campaignId: string,
  patch: UpdateCampaignDraftInput,
): ResultAsync<CampaignDraft, UpdateCampaignDraftError> {
  return ResultAsync.fromPromise(
    drafts.findById(businessId, campaignId),
    (cause): UpdateCampaignDraftError => ({ type: "persistence_failed", cause: String(cause) }),
  ).andThen((existing) => {
    if (existing === null) {
      return errAsync<CampaignDraft, UpdateCampaignDraftError>({
        type: "campaign_not_found",
        campaignId,
      });
    }
    if (existing.lifecycleState !== "draft") {
      return errAsync<CampaignDraft, UpdateCampaignDraftError>({ type: "campaign_not_draft" });
    }
    // 13.9.d: the database CHECK would refuse this as a 503; say it plainly instead.
    if (existing.kind === "quick" && (patch.durationSeconds ?? existing.durationSeconds) > 60) {
      return errAsync<CampaignDraft, UpdateCampaignDraftError>({ type: "quick_too_long" });
    }
    const category = patch.contentCategory ?? existing.contentCategory;
    const audience = patch.audience ?? existing.audience;
    const refusal = categoryRefusal(existing.region, category, audience);
    if (refusal !== null) {
      return errAsync<CampaignDraft, UpdateCampaignDraftError>(refusal);
    }
    const openViewingIssue = openViewingRefusal(
      patch.openViewing ?? existing.openViewing,
      audience,
    );
    if (openViewingIssue !== null) {
      return errAsync<CampaignDraft, UpdateCampaignDraftError>(openViewingIssue);
    }
    return ResultAsync.fromPromise(
      drafts.update(businessId, campaignId, patch),
      (cause): UpdateCampaignDraftError => ({ type: "persistence_failed", cause: String(cause) }),
    ).andThen((updated) =>
      updated === null
        ? errAsync<CampaignDraft, UpdateCampaignDraftError>({
            type: "campaign_not_found",
            campaignId,
          })
        : ResultAsync.fromSafePromise(Promise.resolve(updated)),
    );
  });
}
