// 13.4.d: zod-free, so client components can import these without pulling zod.
import type { CampaignChapter } from "./campaign-chapter";

/**
 * The end of chapter `index` — the next chapter's start, or the campaign's
 * own duration for the last chapter. Pure derivation, no stored copy.
 */
export function chapterEndSeconds(
  chapters: readonly CampaignChapter[],
  index: number,
  durationSeconds: number,
): number {
  return chapters[index + 1]?.startSeconds ?? durationSeconds;
}

/**
 * Allocates a campaign's total `rewardPoints` across its chapters
 * proportionally to `rewardWeight`, remainder folded into the LAST chapter
 * so the allocation always sums exactly to the total — the same rounding
 * rule `money.ts`'s integer helpers use throughout this package, and the
 * one apps/web's `derive-chapters.ts` (`distributeBackLoaded`) reimplements
 * today against a fixed weight set. This generalises it to whatever weights
 * the campaign actually carries.
 */
export function chapterRewardPoints(
  chapters: readonly CampaignChapter[],
  totalRewardPoints: number,
): number[] {
  if (chapters.length === 0) return [];

  const weightSum = chapters.reduce((sum, chapter) => sum + chapter.rewardWeight, 0);
  const allocations = chapters.map((chapter) =>
    Math.floor((totalRewardPoints * chapter.rewardWeight) / weightSum),
  );
  const allocatedTotal = allocations.reduce((sum, value) => sum + value, 0);
  const remainder = totalRewardPoints - allocatedTotal;
  const lastIndex = allocations.length - 1;
  allocations[lastIndex] = (allocations[lastIndex] ?? 0) + remainder;

  return allocations;
}
