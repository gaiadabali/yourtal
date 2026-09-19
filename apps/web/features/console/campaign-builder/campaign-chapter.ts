/**
 * Chapters (docs/06-longform-video-and-attention.md §3: "Split every long
 * video into chapters with a reward released at each checkpoint") and the
 * data-cost estimate the entry card promises (§2.3). Both are pure,
 * dependency-free functions so they can run on every keystroke of the
 * builder's chapter editor with no bundle cost.
 */
export interface CampaignChapter {
  id: string;
  title: string;
  /** Seconds from the start of the video where this chapter begins. The first chapter is always 0. */
  startSeconds: number;
}

/** Total video length is derived from the last chapter's start plus its own minimum length, never entered as a separate field the chapters could silently disagree with. */
const MIN_LAST_CHAPTER_SECONDS = 30;

export function totalDurationSeconds(chapters: readonly CampaignChapter[]): number {
  if (chapters.length === 0) {
    return 0;
  }
  const last = chapters[chapters.length - 1];
  return (last?.startSeconds ?? 0) + MIN_LAST_CHAPTER_SECONDS;
}

/**
 * Estimated data cost at the platform's default quality tier
 * (docs/06 §2.3 rule 1: "Default to 360-480p") — 6 MB per minute, read
 * directly off that section's own worked table (1 min -> 6 MB, 30 min ->
 * 180 MB). This is an estimate shown with "~" at every call site
 * (`campaign-format.ts`'s `formatDataCost`, reused unmodified from
 * `features/campaign`), never a promise of exact bytes.
 */
const DEFAULT_QUALITY_MB_PER_MINUTE = 6;

export function estimateDataMb(durationSeconds: number): number {
  return Math.round((durationSeconds / 60) * DEFAULT_QUALITY_MB_PER_MINUTE);
}

export function createChapter(
  title: string,
  startSeconds: number,
  idFactory: () => string = () => crypto.randomUUID(),
): CampaignChapter {
  return { id: idFactory(), title, startSeconds: Math.max(0, Math.round(startSeconds)) };
}

/** Chapters are always kept sorted by `startSeconds` — the timeline the builder shows must match the order they will actually appear in the player. */
export function sortChapters(chapters: readonly CampaignChapter[]): CampaignChapter[] {
  return [...chapters].sort((a, b) => a.startSeconds - b.startSeconds);
}
