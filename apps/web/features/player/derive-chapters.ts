import type { Chapter } from "./chapter";

export interface ChapterSourceCampaign {
  durationSeconds: number;
  /** Plain number, not the branded `Points` type — this module does pure arithmetic and never re-exports a `Points` value; callers convert at their own display boundary (see chapter.ts). */
  rewardPoints: number;
}

/**
 * Deterministically derives chapter markers from a campaign, since
 * `packages/contracts` has no chapter data yet (see chapter.ts's "KNOWN
 * GAP" note). Chapter count and shape follow
 * docs/tasks/phase-minus-1-pilot.md YT-0002 ("chaptered into 5 segments")
 * rather than inventing an unrelated scheme.
 *
 * The reward curve is deliberately back-loaded per
 * docs/06-longform-video-and-attention.md §3: "completing the last chapter
 * should be worth more than the first three combined... that is what
 * converts 'sampled it' into 'finished it'." The weights below reproduce
 * that section's own worked example exactly: for a 2,000-point campaign,
 * `[1, 1, 1, 2, 5]` (sum 10) yields `200, 200, 200, 400, 1000` — the same
 * numbers the doc's ASCII diagram shows. The first three weights combined
 * (3) are comfortably less than the last (5).
 */
const CHAPTER_COUNT = 5;
const BACK_LOADED_WEIGHTS: readonly number[] = [1, 1, 1, 2, 5];

export function deriveChapters(campaign: ChapterSourceCampaign): Chapter[] {
  const boundaries = splitDurationEvenly(campaign.durationSeconds, CHAPTER_COUNT);
  const rewards = distributeBackLoaded(campaign.rewardPoints, BACK_LOADED_WEIGHTS);

  return boundaries.map((boundary, index) => ({
    index,
    label: `Chapter ${index + 1}`,
    startSeconds: boundary.startSeconds,
    endSeconds: boundary.endSeconds,
    rewardPoints: rewards[index] ?? 0,
  }));
}

interface DurationBoundary {
  startSeconds: number;
  endSeconds: number;
}

/** Splits a duration into `count` whole-second segments, remainder on the last so the total always sums exactly. */
function splitDurationEvenly(totalSeconds: number, count: number): DurationBoundary[] {
  const baseLength = Math.floor(totalSeconds / count);
  const boundaries: DurationBoundary[] = [];
  let cursor = 0;

  for (let index = 0; index < count; index += 1) {
    const isLast = index === count - 1;
    const length = isLast ? totalSeconds - cursor : baseLength;
    boundaries.push({ startSeconds: cursor, endSeconds: cursor + length });
    cursor += length;
  }

  return boundaries;
}

/**
 * Allocates `total` across `weights` proportionally, with the rounding
 * remainder folded into the final (largest-weighted, by construction here)
 * entry — so the allocation always sums exactly to `total` and the
 * back-loaded shape only gets more pronounced, never less.
 */
function distributeBackLoaded(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const allocations = weights.map((weight) => Math.floor((total * weight) / weightSum));
  const allocatedTotal = allocations.reduce((sum, value) => sum + value, 0);
  const remainder = total - allocatedTotal;
  const lastIndex = allocations.length - 1;

  if (lastIndex >= 0) {
    allocations[lastIndex] = (allocations[lastIndex] ?? 0) + remainder;
  }

  return allocations;
}
