import { errAsync, ResultAsync } from "neverthrow";
import {
  exceedsAccuracyBonusRatio,
  exceedsRewardCeiling,
} from "@yourtal/contracts/campaign/reward-config";
import { questionsAskedFor } from "@yourtal/contracts/question/bank";
import type { Points } from "@yourtal/contracts/money";
import { toPoints } from "@yourtal/contracts/money";
import type { Currency } from "@yourtal/contracts/money/currency";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type {
  CampaignDraft,
  CampaignDraftRepository,
} from "../persistence/campaign-draft.repository";
import type {
  RewardConfigRecord,
  RewardConfigRepository,
} from "../persistence/reward-config.repository";
import type { SetRewardConfigError } from "../studio.errors";

export interface SetRewardConfigInput {
  readonly businessId: string;
  readonly campaignId: string;
  readonly allocationId: string;
  readonly rewardPointsPerCompletion: Points;
  readonly accuracyBonusPoints: Points;
  readonly maxPointsForCampaign: Points;
}

/**
 * TASKS.md 7.3.h (requested by D/7.8): one completion's reward (base +
 * bonus), priced in the business's own currency for Studio's risk banner.
 * `quotePurchase` (P_issue, the points-PACK price every business already
 * sees when buying points) is what prices this — never `quote`/B, the
 * redemption-side backing rate that must never reach a browser.
 */
export interface RewardValue {
  readonly rewardValueMinor: number;
  readonly currency: Currency;
}

export type SetRewardConfigResult = CampaignDraft & RewardValue;

const REWARD_CEILING_SETTING_KEY = "reward_ceiling_points_per_minute";

/**
 * TASKS.md 7.3.c. Every check here is a REFUSAL, never a clamp: F14's
 * ceiling, the 40%-bonus ratio, and allocation ownership all read as a
 * clean 400 rather than a silently-adjusted number a business never asked
 * for.
 */
export function setRewardConfig(
  deps: {
    readonly drafts: CampaignDraftRepository;
    readonly rewardConfigs: RewardConfigRepository;
    readonly ledger: Pick<
      LedgerInternalClient,
      "listAllocations" | "getSettings" | "quotePurchase"
    >;
  },
  input: SetRewardConfigInput,
): ResultAsync<SetRewardConfigResult, SetRewardConfigError> {
  return wrap(deps.drafts.findById(input.businessId, input.campaignId)).andThen((draft) => {
    if (draft === null) {
      return errAsync<SetRewardConfigResult, SetRewardConfigError>({
        type: "campaign_not_found",
        campaignId: input.campaignId,
      });
    }
    if (draft.lifecycleState !== "draft") {
      return errAsync<SetRewardConfigResult, SetRewardConfigError>({ type: "campaign_not_draft" });
    }
    if (exceedsAccuracyBonusRatio(input)) {
      return errAsync<SetRewardConfigResult, SetRewardConfigError>({
        type: "accuracy_bonus_too_high",
      });
    }

    return deps.ledger
      .listAllocations(input.businessId)
      .mapErr((error): SetRewardConfigError => ({
        type: "ledger_refused",
        code: error.code,
        message: error.message,
      }))
      .andThen((allocations) => {
        const allocation = allocations.find((row) => row.allocationId === input.allocationId);
        if (allocation === undefined) {
          return errAsync<SetRewardConfigResult, SetRewardConfigError>({
            type: "allocation_not_owned",
            allocationId: input.allocationId,
          });
        }
        if (allocation.funderType !== "partner") {
          return errAsync<SetRewardConfigResult, SetRewardConfigError>({
            type: "allocation_not_partner_funded",
            allocationId: input.allocationId,
          });
        }

        return wrap(deps.ledger.getSettings(draft.region)).andThen((settings) => {
          const ceiling = settings.find(
            (setting) => setting.key === REWARD_CEILING_SETTING_KEY,
          )?.value;
          if (typeof ceiling !== "number") {
            return errAsync<SetRewardConfigResult, SetRewardConfigError>({
              type: "persistence_failed",
              cause: `${REWARD_CEILING_SETTING_KEY} setting missing or malformed for region ${draft.region}`,
            });
          }
          if (exceedsRewardCeiling(input, draft.durationSeconds, ceiling)) {
            return errAsync<SetRewardConfigResult, SetRewardConfigError>({
              type: "reward_exceeds_ceiling",
              ceilingPoints: ceiling,
            });
          }

          const record: RewardConfigRecord = {
            campaignId: input.campaignId,
            allocationId: input.allocationId,
            funderType: "partner",
            maxPointsForCampaign: input.maxPointsForCampaign,
            rewardPointsPerCompletion: input.rewardPointsPerCompletion,
            accuracyBonusPoints: input.accuracyBonusPoints,
          };

          return wrap(deps.rewardConfigs.upsert(record)).andThen(() =>
            wrap(
              deps.drafts.patchRewardMirror(input.businessId, input.campaignId, {
                rewardPoints: input.rewardPointsPerCompletion,
                questionCount: questionsAskedFor(draft.durationSeconds),
                scoringRule:
                  input.accuracyBonusPoints > 0 ? "base_plus_accuracy_bonus" : "base_only",
              }),
            )
              .andThen((updated) =>
                updated === null
                  ? errAsync<CampaignDraft, SetRewardConfigError>({
                      type: "campaign_not_found",
                      campaignId: input.campaignId,
                    })
                  : ResultAsync.fromSafePromise<CampaignDraft, SetRewardConfigError>(
                      Promise.resolve(updated),
                    ),
              )
              .andThen((updated) =>
                deps.ledger
                  .quotePurchase({
                    points: toPoints(input.rewardPointsPerCompletion + input.accuracyBonusPoints),
                    region: updated.region,
                  })
                  .mapErr((error): SetRewardConfigError => ({
                    type: "ledger_refused",
                    code: error.code,
                    message: error.message,
                  }))
                  .map((priced): SetRewardConfigResult => ({
                    ...updated,
                    rewardValueMinor: priced.totalMinor,
                    currency: priced.currency,
                  })),
              ),
          );
        });
      });
  });
}

function wrap<T>(promise: Promise<T>): ResultAsync<T, SetRewardConfigError> {
  return ResultAsync.fromPromise(promise, (cause): SetRewardConfigError => ({
    type: "persistence_failed",
    cause: String(cause),
  }));
}
