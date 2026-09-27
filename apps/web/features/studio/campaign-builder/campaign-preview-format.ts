/**
 * Pure, dependency-free formatting for the builder's own entry-card
 * preview (`campaign-entry-preview.tsx`). This deliberately does NOT reuse
 * `features/campaign/campaign-format.ts` / `campaign-reward-split.ts` even
 * though they compute the same facts: those files value-import
 * `@yourtal/contracts/money` (a Zod-branded schema module) and
 * `next-intl`, and this preview renders inside `campaign-editor.tsx` — a
 * "use client" tree that re-renders on every keystroke. Importing either
 * one here would have pulled that whole graph into the Campaigns route's
 * client bundle (verified: it blew the 200 KB gz gate from ~287 KB before
 * this file existed — see this ticket's report). The business console is
 * English-only throughout anyway (`team-screen.tsx` etc. carry no
 * next-intl catalogue), so a plain-English implementation is also the more
 * consistent choice here, not just the cheaper one.
 */
const BASE_REWARD_RATIO = 0.6;

export interface PreviewRewardSplit {
  basePoints: number;
  maxAccuracyBonusPoints: number;
}

/** Mirrors `campaign-reward-split.ts`'s 60/40 split (docs/06 §4.2), on plain numbers rather than the branded `Points` type — display-only, never the value path. */
export function splitPreviewReward(
  rewardPoints: number,
  hasAccuracyBonus: boolean,
): PreviewRewardSplit {
  if (!hasAccuracyBonus) {
    return { basePoints: rewardPoints, maxAccuracyBonusPoints: 0 };
  }
  const basePoints = Math.round(rewardPoints * BASE_REWARD_RATIO);
  return { basePoints, maxAccuracyBonusPoints: Math.max(0, rewardPoints - basePoints) };
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
