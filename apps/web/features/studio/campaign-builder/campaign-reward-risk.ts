/**
 * Surfaces the ratio the risk register calls out: "reward must dwarf data
 * cost" (rule of thumb: reward value >= 20x the viewer's data cost). This is
 * an authoring-time ADVISORY, not a hard block — an advertiser can still
 * submit a low-ratio campaign; they cannot claim they were not shown what
 * it looks like.
 *
 * `rewardValueMinorUnits` is a SERVER-computed input, not derived here.
 * B (the backing rate) never reaches a browser (CLAUDE.md), so this module
 * used to multiply `rewardPoints` by a mock rate imported from
 * `@yourtal/contracts/money/mock-backing-rate` — that computation is gone
 * (task 7.8.c). Until 7.3's reward/budget endpoint returns this ratio (or
 * the reward's money value) directly, `rewardValueMinorUnits` is `null` and
 * the banner says so honestly rather than guessing.
 *
 * (requested by D/7.8, for A under 7.3) `POST/PATCH .../campaigns/:id`
 * (or a dedicated quote) should return the reward's value in the business's
 * own currency so this banner can show a real ratio again.
 *
 * The DATA-COST side of the ratio is not B and stays a local estimate:
 * IDR 720 for 180 MB in the risk register's own table (30 min at 480p) is
 * almost exactly 4 Rupiah/MB.
 */
const MOCK_DATA_COST_IDR_PER_MB = 4;
/**
 * Illustrative only: Australian mobile data is comparatively cheap and
 * plans are commonly near-unlimited, so this rule is written for the
 * Indonesian data-cost reality — an AU campaign is not expected to trip it
 * under ordinary reward levels, which is itself the correct, honest
 * behaviour for a market where this specific risk does not apply the same
 * way.
 */
const MOCK_DATA_COST_AUD_CENTS_PER_MB = 0.2;

const MIN_REWARD_TO_DATA_COST_RATIO = 20;

export interface RewardDataCostAssessment {
  ratio: number | null;
  meetsGuideline: boolean | null;
  dataCostMinorUnits: number;
  rewardValueMinorUnits: number | null;
}

/**
 * `rewardValueMinorUnits` is `null` until a server endpoint supplies it
 * (see module doc) — every other argument stays client-computable.
 */
export function assessRewardToDataCost(
  rewardValueMinorUnits: number | null,
  estimatedDataMb: number,
  currency: "IDR" | "AUD",
): RewardDataCostAssessment {
  const dataCostMinorUnits = Math.round(
    estimatedDataMb *
      (currency === "IDR" ? MOCK_DATA_COST_IDR_PER_MB : MOCK_DATA_COST_AUD_CENTS_PER_MB),
  );

  if (rewardValueMinorUnits === null) {
    return { ratio: null, meetsGuideline: null, dataCostMinorUnits, rewardValueMinorUnits: null };
  }

  const ratio =
    dataCostMinorUnits > 0 ? rewardValueMinorUnits / dataCostMinorUnits : Number.POSITIVE_INFINITY;

  return {
    ratio,
    meetsGuideline: ratio >= MIN_REWARD_TO_DATA_COST_RATIO,
    dataCostMinorUnits,
    rewardValueMinorUnits: Math.round(rewardValueMinorUnits),
  };
}

/** A translate function shaped like next-intl's `useTranslations("studio")` — passed in rather than imported, so this stays a plain, dependency-free logic module. */
export type RewardRiskTranslator = (key: string, values?: Record<string, string | number>) => string;

/** Plain-language summary for the builder's risk banner — the ratio itself, not just a pass/fail badge. */
export function describeRewardDataCostRatio(
  assessment: RewardDataCostAssessment,
  t: RewardRiskTranslator,
): string {
  if (assessment.ratio === null) {
    return t("campaignBuilder.reward.ratioUnavailable");
  }
  if (!Number.isFinite(assessment.ratio)) {
    return t("campaignBuilder.reward.ratioNoDataCost");
  }
  const roundedRatio = Math.round(assessment.ratio * 10) / 10;
  return t(
    assessment.meetsGuideline
      ? "campaignBuilder.reward.ratioMeetsGuideline"
      : "campaignBuilder.reward.ratioBelowGuideline",
    { ratio: roundedRatio },
  );
}
