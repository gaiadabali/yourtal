import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { CampaignDraft } from "../persistence/campaign-draft.repository";
import type { BusinessAccountRepository } from "../../business/persistence/business-account.repository";
import { transitionCampaignLifecycle } from "./transition-campaign-lifecycle.use-case";
import type { CampaignPublishedPublisher } from "../campaign-published-publisher";
import type { CampaignDraftRepository } from "../persistence/campaign-draft.repository";
import type { QuestionBankRepository } from "../persistence/question-bank.repository";
import { campaignReadiness, describeReadiness } from "./campaign-readiness";
import type { RewardConfigRepository } from "../persistence/reward-config.repository";
import type { TermsVersionRepository } from "../persistence/terms-version.repository";
import type { ModerationDriver } from "@yourtal/drivers/moderation";
import type { SubmitCampaignError } from "../studio.errors";

/**
 * TASKS.md 7.3.d: draft -> in_review. Refused while the business is not
 * KYB-verified (red line 7) — everything else about legality
 * (canTransition, the media/reward CHECKs) is `transitionCampaignLifecycle`'s
 * own concern, shared with whatever later moves the campaign the rest of
 * the way to `live` (9.2, out of this phase's scope).
 */
export function submitCampaign(
  deps: {
    readonly businesses: BusinessAccountRepository;
    readonly drafts: CampaignDraftRepository;
    readonly bank: Pick<QuestionBankRepository, "listByCampaign">;
    readonly rewardConfigs: RewardConfigRepository;
    readonly termsVersions: TermsVersionRepository;
    readonly publisher: CampaignPublishedPublisher;
    /** 13.3.b: the simulated automated screen, before a human moderator. */
    readonly moderation: Pick<ModerationDriver, "classify">;
  },
  businessId: string,
  campaignId: string,
): ResultAsync<CampaignDraft, SubmitCampaignError> {
  return ResultAsync.fromPromise(
    deps.businesses.findById(businessId),
    (cause): SubmitCampaignError => ({ type: "persistence_failed", cause: String(cause) }),
  ).andThen((business) => {
    if (business === null) {
      return errAsync<CampaignDraft, SubmitCampaignError>({
        type: "business_not_found",
        businessId,
      });
    }
    if (!business.isVerified) {
      return errAsync<CampaignDraft, SubmitCampaignError>({ type: "not_kyb_verified" });
    }
    return checkReadiness(deps, businessId, campaignId)
      .andThen(() => screenCreative(deps, businessId, campaignId))
      .andThen(() =>
        transitionCampaignLifecycle(deps, businessId, campaignId, "in_review").mapErr(
          (error): SubmitCampaignError =>
            error.type === "campaign_not_found"
              ? { type: "campaign_not_found", campaignId: error.campaignId }
              : error,
        ),
      );
  });
}

/**
 * Refuses a draft that lacks something review needs, naming each gap, instead of
 * letting the database refuse the transition with no reason. Only a `draft` is
 * checked: any other state reaches the lifecycle's own refusal below.
 */
function checkReadiness(
  deps: Pick<Parameters<typeof submitCampaign>[0], "drafts" | "bank">,
  businessId: string,
  campaignId: string,
): ResultAsync<undefined, SubmitCampaignError> {
  return ResultAsync.fromPromise(
    (async () => {
      const draft = await deps.drafts.findById(businessId, campaignId);
      if (draft === null || draft.lifecycleState !== "draft") return { draft, bank: [] };
      return { draft, bank: await deps.bank.listByCampaign(campaignId) };
    })(),
    (cause): SubmitCampaignError => ({ type: "persistence_failed", cause: String(cause) }),
  ).andThen(({ draft, bank }) => {
    if (draft === null) {
      return errAsync<undefined, SubmitCampaignError>({ type: "campaign_not_found", campaignId });
    }
    if (draft.lifecycleState !== "draft") return okAsync<undefined, SubmitCampaignError>(undefined);
    const readiness = campaignReadiness(draft, bank);
    return readiness.gaps.length === 0
      ? okAsync<undefined, SubmitCampaignError>(undefined)
      : errAsync<undefined, SubmitCampaignError>({
          type: "campaign_not_ready",
          missing: readiness.gaps,
          message: describeReadiness(readiness),
          questionsNeeded: readiness.questionsNeeded,
          questionsHave: readiness.questionsHave,
        });
  });
}

/**
 * Blocks only on a clear `block`. `review`, and a screen that is down, go on
 * to the human moderator, who reviews every campaign anyway.
 */
function screenCreative(
  deps: Pick<Parameters<typeof submitCampaign>[0], "drafts" | "moderation">,
  businessId: string,
  campaignId: string,
): ResultAsync<undefined, SubmitCampaignError> {
  return ResultAsync.fromPromise(
    deps.drafts.findById(businessId, campaignId),
    (cause): SubmitCampaignError => ({ type: "persistence_failed", cause: String(cause) }),
  ).andThen((draft) => {
    if (draft === null) {
      return errAsync<undefined, SubmitCampaignError>({ type: "campaign_not_found", campaignId });
    }
    return ResultAsync.fromSafePromise(
      deps.moderation.classify(`${draft.title}\n${draft.synopsis}`),
    ).andThen((verdict) =>
      verdict.isOk() && verdict.value.outcome === "block"
        ? errAsync<undefined, SubmitCampaignError>({
            type: "creative_blocked",
            category: verdict.value.category,
          })
        : okAsync<undefined, SubmitCampaignError>(undefined),
    );
  });
}
