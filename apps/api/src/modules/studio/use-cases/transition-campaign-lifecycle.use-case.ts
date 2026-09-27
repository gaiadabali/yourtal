import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { canTransition, refuseTransition } from "@yourtal/contracts/campaign/lifecycle";
import type { CampaignLifecycleState } from "@yourtal/contracts/campaign/lifecycle";
import type { CampaignPublishedPublisher } from "../campaign-published-publisher";
import type {
  CampaignDraft,
  CampaignDraftRepository,
} from "../persistence/campaign-draft.repository";
import type { RewardConfigRepository } from "../persistence/reward-config.repository";
import type { TermsVersionRepository } from "../persistence/terms-version.repository";
import type { IllegalTransitionError, PersistenceFailedError } from "../studio.errors";

export type TransitionError =
  | { readonly type: "campaign_not_found"; readonly campaignId: string }
  | IllegalTransitionError
  | PersistenceFailedError;

/**
 * TASKS.md 7.3.d/7.3.f: the ONE place `lifecycle_state` ever changes. Every
 * caller goes through this — Studio's own `submit` (draft -> in_review,
 * this phase) and 9.2's future moderation queue (in_review -> live, staff's
 * endpoint, not this phase's to build) alike — so the `live` side effects
 * (freezing a terms_version, emitting `campaign.published`) happen exactly
 * once, from exactly one function, no matter who calls it.
 *
 * `canTransition` is checked here BEFORE the write, even though
 * `campaign.assert_lifecycle_transition()` (20260927140000, EW-17) enforces
 * the identical table at the database — so a caller gets a clean 400 with a
 * real reason instead of a raw constraint-violation 500.
 */
export function transitionCampaignLifecycle(
  deps: {
    readonly drafts: CampaignDraftRepository;
    readonly rewardConfigs: RewardConfigRepository;
    readonly termsVersions: TermsVersionRepository;
    readonly publisher: CampaignPublishedPublisher;
  },
  businessId: string,
  campaignId: string,
  to: CampaignLifecycleState,
): ResultAsync<CampaignDraft, TransitionError> {
  return wrap(deps.drafts.findById(businessId, campaignId)).andThen((draft) => {
    if (draft === null) {
      return errAsync<CampaignDraft, TransitionError>({
        type: "campaign_not_found",
        campaignId,
      });
    }
    if (!canTransition(draft.lifecycleState, to)) {
      return errAsync<CampaignDraft, TransitionError>({
        type: "illegal_transition",
        reason: refuseTransition(draft.lifecycleState, to).reason,
      });
    }

    return wrap(deps.drafts.transitionLifecycle(businessId, campaignId, to)).andThen((result) => {
      if (!result.ok) {
        return errAsync<CampaignDraft, TransitionError>({
          type: "illegal_transition",
          reason: "the database refused this transition",
        });
      }
      if (to !== "live") {
        return okAsync<CampaignDraft, TransitionError>(result.draft);
      }
      return wrap(publishSideEffects(deps, result.draft)).map(() => result.draft);
    });
  });
}

/**
 * 7.3.c: "publishing snapshots a terms version that includes the bonus."
 * 7.3.f: the pg-boss event a campaign's followers get notified from.
 * Both fire exactly once per `live` transition, in that order — the
 * promise is frozen before anyone is told the campaign exists.
 */
async function publishSideEffects(
  deps: {
    readonly rewardConfigs: RewardConfigRepository;
    readonly termsVersions: TermsVersionRepository;
    readonly publisher: CampaignPublishedPublisher;
  },
  draft: CampaignDraft,
): Promise<void> {
  const rewardConfig = await deps.rewardConfigs.findByCampaignId(draft.id);
  if (rewardConfig !== null && draft.scoringRule !== null && draft.questionCount !== null) {
    const nextVersion = (await deps.termsVersions.latestVersion(draft.id)) + 1;
    await deps.termsVersions.insert({
      campaignId: draft.id,
      version: nextVersion,
      rewardPoints: rewardConfig.rewardPointsPerCompletion,
      questionCount: draft.questionCount,
      scoringRule: draft.scoringRule,
      durationSeconds: draft.durationSeconds,
      accuracyBonusPoints: rewardConfig.accuracyBonusPoints,
      effectiveFrom: draft.publishedAt ?? new Date().toISOString(),
    });
  }

  await deps.publisher.publish({
    campaignId: draft.id,
    businessId: draft.businessId,
    region: draft.region,
    idempotencyKey: `campaign_published_${draft.id}`,
  });
}

function wrap<T>(promise: Promise<T>): ResultAsync<T, TransitionError> {
  return ResultAsync.fromPromise(promise, (cause): TransitionError => ({
    type: "persistence_failed",
    cause: String(cause),
  }));
}
