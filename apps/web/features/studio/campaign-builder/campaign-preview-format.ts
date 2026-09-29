/**
 * Pure, dependency-free formatting for the builder's own entry-card
 * preview (`campaign-entry-preview.tsx`). This deliberately does NOT reuse
 * `features/campaign/campaign-format.ts` even though it computes some of
 * the same facts: that module value-imports `@yourtal/contracts/money` (a
 * Zod-branded schema module) and `next-intl`, and this preview renders
 * inside `campaign-editor.tsx` — a "use client" tree that re-renders on
 * every keystroke. Importing it here would have pulled that whole graph
 * into the Campaigns route's client bundle (verified: it blew the 200 KB
 * gz gate from ~287 KB before this file existed — see this ticket's
 * report). The business console is English-only throughout anyway
 * (`team-screen.tsx` etc. carry no next-intl catalogue), so a
 * plain-English implementation is also the more consistent choice here,
 * not just the cheaper one.
 */

export interface PreviewRewardSplit {
  basePoints: number;
  maxAccuracyBonusPoints: number;
}

/**
 * `draft.rewardPoints` is already the base amount
 * (`CampaignRewardConfig.rewardPointsPerCompletion`) and
 * `draft.accuracyBonusPoints` is the real bonus the advertiser has set —
 * both genuine draft fields, not a fabricated ratio (11.5.a deleted
 * `campaign-reward-split.ts`'s 60/40 placeholder for exactly this reason).
 * This function now only enforces "0 when the scoring rule doesn't pay
 * one," never invents a split.
 */
export function splitPreviewReward(
  rewardPoints: number,
  accuracyBonusPoints: number,
  hasAccuracyBonus: boolean,
): PreviewRewardSplit {
  return {
    basePoints: rewardPoints,
    maxAccuracyBonusPoints: hasAccuracyBonus ? Math.max(0, accuracyBonusPoints) : 0,
  };
}

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

export function formatPreviewPoints(points: number): string {
  return `${NUMBER_FORMATTER.format(points)} points`;
}

export function formatPreviewDuration(durationSeconds: number): string {
  if (durationSeconds < 60) {
    return `${Math.round(durationSeconds)} sec`;
  }
  const minutes = Math.round(durationSeconds / 60);
  return `${minutes} min`;
}

/** Same "~" convention as `campaign-format.ts`'s `formatDataCost` — an estimate, never a false-precise promise. */
export function formatPreviewDataCost(estimatedDataMb: number): string {
  return `~${Math.round(estimatedDataMb)} MB`;
}

export function describePreviewQuestionCount(questionCount: number): string {
  if (questionCount === 0) {
    return "No questions";
  }
  return questionCount === 1 ? "1 question" : `${questionCount} questions`;
}

export function describePreviewScoringRule(hasAccuracyBonus: boolean): string {
  return hasAccuracyBonus
    ? "Base reward for completing, plus an accuracy bonus"
    : "Fixed reward for completing and answering";
}
