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
import type { useTranslations } from "next-intl";

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

/**
 * What the ratio banner and the entry-card preview both say, from one place so the
 * two can never disagree. Before there is a server-priced reward value (it arrives
 * when the reward is saved), the ratio is not worked out: the author is told what
 * is missing instead, and a draft with no reward yet is not scolded for it.
 */
export type RewardRatioNote =
  "needsVideo" | "needsReward" | "needsSave" | "noDataCost" | "meetsGuideline" | "belowGuideline";

export interface RewardRatioView {
  note: RewardRatioNote;
  /** Only for the two worked-out notes. */
  ratio: number | null;
}

export function rewardRatioView(input: {
  rewardPoints: number;
  rewardValueMinorUnits: number | null;
  estimatedDataMb: number;
  currency: "IDR" | "AUD";
  /** The video's real length is not known yet, so neither is its data cost. */
  durationPending: boolean;
  /** The reward on screen differs from the saved one, so the priced value no longer matches it. */
  rewardUnsaved?: boolean;
}): RewardRatioView {
  if (input.durationPending) return { note: "needsVideo", ratio: null };
  if (input.rewardPoints <= 0) return { note: "needsReward", ratio: null };
  if (input.rewardUnsaved === true) return { note: "needsSave", ratio: null };
  const assessment = assessRewardToDataCost(
    input.rewardValueMinorUnits,
    input.estimatedDataMb,
    input.currency,
  );
  if (assessment.ratio === null) return { note: "needsSave", ratio: null };
  if (!Number.isFinite(assessment.ratio)) return { note: "noDataCost", ratio: null };
  return {
    note: assessment.meetsGuideline ? "meetsGuideline" : "belowGuideline",
    ratio: Math.round(assessment.ratio * 10) / 10,
  };
}

/** Plain-language summary: the ratio itself when it is known, else what is still needed. */
export function rewardRatioText(
  view: RewardRatioView,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (view.note) {
    case "needsVideo":
      return t("campaignBuilder.reward.ratioNeedsVideo");
    case "needsReward":
      return t("campaignBuilder.reward.ratioNeedsReward");
    case "needsSave":
      return t("campaignBuilder.reward.ratioNeedsSave");
    case "noDataCost":
      return t("campaignBuilder.reward.ratioNoDataCost");
    case "meetsGuideline":
      return t("campaignBuilder.reward.ratioMeetsGuideline", { ratio: view.ratio ?? 0 });
    case "belowGuideline":
      return t("campaignBuilder.reward.ratioBelowGuideline", { ratio: view.ratio ?? 0 });
  }
}
