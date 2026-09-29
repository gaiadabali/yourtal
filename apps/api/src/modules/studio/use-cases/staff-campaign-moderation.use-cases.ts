import { errAsync, ResultAsync } from "neverthrow";
import { detectPiiRequest, detectPredictionRequest } from "@yourtal/contracts/question/pii-guard";
import type { Audience } from "@yourtal/contracts/campaign";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";
import type { CampaignDraft, CampaignDraftRepository } from "../persistence/campaign-draft.repository";
import type { QuestionBankRepository } from "../persistence/question-bank.repository";
import type { RewardConfigRepository } from "../persistence/reward-config.repository";
import type { TermsVersionRepository } from "../persistence/terms-version.repository";
import type { CampaignPublishedPublisher } from "../campaign-published-publisher";
import { transitionCampaignLifecycle } from "./transition-campaign-lifecycle.use-case";
import { categoryRefusal } from "./category-policy";
import type {
  ListCampaignModerationQueueError,
  ModerateCampaignError,
} from "../studio.errors";

/**
 * TASKS.md 9.2.a: the campaign half of the staff moderation queue. Reuses
 * `transitionCampaignLifecycle` (7.3's own doc comment names this exact
 * caller: "9.2's future moderation queue (in_review -> live, staff's
 * endpoint, not this phase's to build)") so the `live` side effects --
 * freezing a terms_version, emitting `campaign.published` -- happen through
 * the SAME one function Studio's own submit path uses, never a second copy.
 */
export interface StaffModerationDeps {
  readonly drafts: CampaignDraftRepository;
  readonly bank: QuestionBankRepository;
  readonly rewardConfigs: RewardConfigRepository;
  readonly termsVersions: TermsVersionRepository;
  readonly publisher: CampaignPublishedPublisher;
}

export interface CampaignModerationFlag {
  readonly questionId: string;
  readonly kind: "pii" | "prediction";
  readonly category?: string;
  readonly reason: string;
}

export interface CampaignModerationQueueItem {
  readonly campaign: CampaignDraft;
  readonly flags: readonly CampaignModerationFlag[];
}

/**
 * Re-runs the same automated screen `create-question.use-case.ts` already
 * enforces at save time. Nothing should ever be flagged here in practice --
 * that guard already refuses PII/prediction prompts outright -- but a
 * moderator reviewing the bank is the second line of defense docs/18 asks
 * for, and re-screening here (rather than trusting the `clear` verdict
 * stamped at save time) is what actually makes it one.
 */
async function flagsFor(
  bank: QuestionBankRepository,
  campaignId: string,
): Promise<readonly CampaignModerationFlag[]> {
  const questions = await bank.listByCampaign(campaignId);
  const flags: CampaignModerationFlag[] = [];
  for (const record of questions) {
    const pii = detectPiiRequest(record.question.prompt);
    if (pii !== null) {
      flags.push({
        questionId: record.question.id,
        kind: "pii",
        category: pii.category,
        reason: pii.reason,
      });
    }
    const prediction = detectPredictionRequest(record.question.prompt);
    if (prediction !== null) {
      flags.push({ questionId: record.question.id, kind: "prediction", reason: prediction.reason });
    }
  }
  return flags;
}

export function listCampaignModerationQueue(
  deps: Pick<StaffModerationDeps, "drafts" | "bank">,
): ResultAsync<readonly CampaignModerationQueueItem[], ListCampaignModerationQueueError> {
  return ResultAsync.fromPromise(
    deps.drafts.listInReview(),
    (cause): ListCampaignModerationQueueError => ({
      type: "persistence_failed",
      cause: String(cause),
    }),
  ).andThen((campaigns) =>
    ResultAsync.fromPromise(
      Promise.all(
        campaigns.map(async (campaign) => ({
          campaign,
          flags: await flagsFor(deps.bank, campaign.id),
        })),
      ),
      (cause): ListCampaignModerationQueueError => ({
        type: "persistence_failed",
        cause: String(cause),
      }),
    ),
  );
}

export interface CampaignModerationOverrides {
  // Explicit `| undefined`, not just an optional key -- `exactOptionalPropertyTypes`
  // (this repo's tsconfig) distinguishes "key absent" from "key present with
  // value `undefined`", and the DTO's own zod-inferred type (`.optional()`
  // fields) produces the latter.
  readonly audience?: Audience | undefined;
  readonly contentCategory?: ContentCategory | undefined;
}

/**
 * Approves an `in_review` campaign: "confirm or change" (1.1.d) lets the
 * moderator correct a misclassified audience/category before the campaign
 * ever goes live, re-checked through the SAME `categoryRefusal` the
 * business's own save path uses (a moderator's override is not exempt from
 * the policy it is meant to enforce). The question bank is re-screened
 * (`flagsFor`) as the last gate before `live` -- a flagged bank refuses the
 * approval outright, the same way `create-question.use-case.ts` refuses a
 * flagged question at save time.
 */
export function approveCampaignModeration(
  deps: StaffModerationDeps,
  campaignId: string,
  overrides: CampaignModerationOverrides,
): ResultAsync<CampaignDraft, ModerateCampaignError> {
  return ResultAsync.fromPromise(
    deps.drafts.findByIdAnyBusiness(campaignId),
    (cause): ModerateCampaignError => ({ type: "persistence_failed", cause: String(cause) }),
  ).andThen((draft) => {
    if (draft === null) {
      return errAsync<CampaignDraft, ModerateCampaignError>({
        type: "campaign_not_found",
        campaignId,
      });
    }
    if (draft.lifecycleState !== "in_review") {
      return errAsync<CampaignDraft, ModerateCampaignError>({
        type: "campaign_not_pending_review",
        state: draft.lifecycleState,
      });
    }

    const audience = overrides.audience ?? draft.audience;
    const contentCategory = overrides.contentCategory ?? draft.contentCategory;
    const refusal = categoryRefusal(draft.region, contentCategory, audience);
    if (refusal !== null) {
      return errAsync<CampaignDraft, ModerateCampaignError>(refusal);
    }

    return ResultAsync.fromPromise(
      flagsFor(deps.bank, campaignId),
      (cause): ModerateCampaignError => ({ type: "persistence_failed", cause: String(cause) }),
    ).andThen((flags) => {
      const pii = flags.find((flag) => flag.kind === "pii");
      if (pii !== undefined) {
        return errAsync<CampaignDraft, ModerateCampaignError>({
          type: "pii_request",
          category: pii.category ?? "unknown",
          reason: pii.reason,
        });
      }
      const prediction = flags.find((flag) => flag.kind === "prediction");
      if (prediction !== undefined) {
        return errAsync<CampaignDraft, ModerateCampaignError>({
          type: "prediction_request",
          reason: prediction.reason,
        });
      }

      const applyOverrides =
        overrides.audience !== undefined || overrides.contentCategory !== undefined
          ? ResultAsync.fromPromise(
              deps.drafts.update(draft.businessId, campaignId, {
                audience: overrides.audience,
                contentCategory: overrides.contentCategory,
              }),
              (cause): ModerateCampaignError => ({
                type: "persistence_failed",
                cause: String(cause),
              }),
            )
          : ResultAsync.fromSafePromise(Promise.resolve(draft));

      return applyOverrides.andThen(() =>
        transitionCampaignLifecycle(deps, draft.businessId, campaignId, "live").mapErr(
          (error): ModerateCampaignError =>
            error.type === "campaign_not_found"
              ? { type: "campaign_not_found", campaignId: error.campaignId }
              : error,
        ),
      );
    });
  });
}

export function rejectCampaignModeration(
  deps: StaffModerationDeps,
  campaignId: string,
  reason: string,
): ResultAsync<CampaignDraft, ModerateCampaignError> {
  return ResultAsync.fromPromise(
    deps.drafts.findByIdAnyBusiness(campaignId),
    (cause): ModerateCampaignError => ({ type: "persistence_failed", cause: String(cause) }),
  ).andThen((draft) => {
    if (draft === null) {
      return errAsync<CampaignDraft, ModerateCampaignError>({
        type: "campaign_not_found",
        campaignId,
      });
    }
    if (draft.lifecycleState !== "in_review") {
      return errAsync<CampaignDraft, ModerateCampaignError>({
        type: "campaign_not_pending_review",
        state: draft.lifecycleState,
      });
    }
    return transitionCampaignLifecycle(
      deps,
      draft.businessId,
      campaignId,
      "rejected",
      reason,
    ).mapErr(
      (error): ModerateCampaignError =>
        error.type === "campaign_not_found"
          ? { type: "campaign_not_found", campaignId: error.campaignId }
          : error,
    );
  });
}
