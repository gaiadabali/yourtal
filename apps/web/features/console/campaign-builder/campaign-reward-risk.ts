/**
 * Surfaces the ratio the risk register calls out
 * (docs/06-longform-video-and-attention.md §2.3 rule 5): "Reward must
 * dwarf data cost. Rule of thumb: reward value >= 20x the user's data
 * cost." The worked example there is explicit: a 30-minute view costing
 * IDR 720 of data needs a reward worth >= IDR 15,000; a points reward
 * worth only IDR 2,000 "would make watching a net loss for the user once
 * you count their time."
 *
 * This is an authoring-time ADVISORY, not a hard block — nothing in docs/06
 * or docs/tasks/phase-u-ui.md YT-0441 says the platform refuses to publish
 * a low-ratio campaign, only that "the UI should show them the ratio they
 * have created, not silently accept it" (this ticket's brief). An
 * advertiser can still submit a 3x-ratio campaign; they cannot claim they
 * were not shown what it looks like.
 *
 * The backing rates now come from `@yourtal/contracts/money/mock-backing-rate`
 * rather than being declared here. They used to be local copies, on the
 * reasoning that every other mock module carried its own — which was true,
 * and was the problem. A rate copied into four files is a rate that gets
 * updated in three: the fourth would have priced every campaign wrong with
 * nothing failing, because each copy is only ever compared against values
 * that agree with it. That is exactly what would have happened here after
 * decision T-1 moved IDR to whole Rupiah, had this constant stayed local.
 *
 * `MOCK_DATA_COST_IDR_PER_MB` is in the same minor unit as
 * `MOCK_BACKING_RATE_IDR_PER_POINT` for the same reason: `dataCostMinorUnits`
 * and `rewardValueMinorUnits` are named for the stored minor unit and are
 * rendered as money by the builder, so a mismatch between the two would make
 * the banner quote a wrong figure beside a correct-looking ratio — the
 * harder bug, because the ratio alone would not catch it.
 */
import {
  MOCK_BACKING_RATE_AUD_CENTS_PER_POINT,
  MOCK_BACKING_RATE_IDR_PER_POINT,
} from "@yourtal/contracts/money/mock-backing-rate";

/** IDR 720 for 180 MB in docs/06's own table (30 min at 480p) is almost exactly 4 Rupiah/MB. */
const MOCK_DATA_COST_IDR_PER_MB = 4;
/**
 * Illustrative only: Australian mobile data is comparatively cheap and
 * plans are commonly near-unlimited, so this rule is written for the
 * Indonesian data-cost reality docs/06 §2.3 describes — an AU campaign is
 * not expected to trip it under ordinary reward levels, which is itself
 * the correct, honest behaviour for a market where this specific risk does
 * not apply the same way.
 */
const MOCK_DATA_COST_AUD_CENTS_PER_MB = 0.2;

const MIN_REWARD_TO_DATA_COST_RATIO = 20;

export interface RewardDataCostAssessment {
  ratio: number;
  meetsGuideline: boolean;
  dataCostMinorUnits: number;
  rewardValueMinorUnits: number;
}

/**
 * `currency` picks which mock rate pair to use — see the module doc for why
 * both sides must be expressed in the same currency to compare at all.
 */
export function assessRewardToDataCost(
  rewardPoints: number,
  estimatedDataMb: number,
  currency: "IDR" | "AUD",
): RewardDataCostAssessment {
  const dataCostMinorUnits =
    currency === "IDR"
      ? estimatedDataMb * MOCK_DATA_COST_IDR_PER_MB
      : estimatedDataMb * MOCK_DATA_COST_AUD_CENTS_PER_MB;
  const rewardValueMinorUnits =
    currency === "IDR"
      ? rewardPoints * MOCK_BACKING_RATE_IDR_PER_POINT
      : rewardPoints * MOCK_BACKING_RATE_AUD_CENTS_PER_POINT;

  const ratio =
    dataCostMinorUnits > 0 ? rewardValueMinorUnits / dataCostMinorUnits : Number.POSITIVE_INFINITY;

  return {
    ratio,
    meetsGuideline: ratio >= MIN_REWARD_TO_DATA_COST_RATIO,
    dataCostMinorUnits: Math.round(dataCostMinorUnits),
    rewardValueMinorUnits: Math.round(rewardValueMinorUnits),
  };
}

/** Plain-language summary for the builder's risk banner — the ratio itself, not just a pass/fail badge, per this ticket's "show them the ratio they have created" instruction. */
export function describeRewardDataCostRatio(assessment: RewardDataCostAssessment): string {
  if (!Number.isFinite(assessment.ratio)) {
    return "This campaign has no measurable data cost to compare against.";
  }
  const roundedRatio = Math.round(assessment.ratio * 10) / 10;
  if (assessment.meetsGuideline) {
    return `The reward is worth about ${roundedRatio}x the viewer's estimated data cost — at or above the platform's 20x guideline.`;
  }
  return `The reward is worth only about ${roundedRatio}x the viewer's estimated data cost — below the platform's 20x guideline. Asking for this much attention for this little reward reads as insulting to the viewer, and risks low completion and poor reviews.`;
}
