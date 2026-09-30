import * as z from "zod";

/**
 * One chapter marker on a long-form campaign's video (docs/06 section 3:
 * "split every long video into chapters with a reward released at each
 * checkpoint"). YT-0503.
 *
 * `rewardWeight`, not an absolute point value: docs/06 section 3 asks for a
 * deliberately **back-loaded** curve — completing the last chapter worth
 * more than the first three combined — and a weight lets `campaignSchema`'s
 * own `rewardPoints` stay the single source of truth for the total. Storing
 * an absolute per-chapter amount would be a second total nobody guarantees
 * agrees with the first; see `chapterRewardPoints` below for the derivation.
 *
 * `endSeconds` is deliberately absent for the same reason: a chapter's end
 * IS the next chapter's start (or the campaign's own `durationSeconds` for
 * the last one), and storing it separately is exactly the kind of copy
 * docs/13's "never store a value you can derive" rule exists to prevent —
 * apps/web's local `chapter.ts`/`derive-chapters.ts` fakes stored it
 * directly for lack of anywhere else to put it; `chapterEndSeconds` below is
 * what replaces that once this schema is wired in.
 */
export const campaignChapterSchema = z.object({
  title: z.string().min(1).max(120),
  startSeconds: z.number().int().min(0),
  rewardWeight: z.number().positive(),
});

export type CampaignChapter = z.infer<typeof campaignChapterSchema>;

export { chapterEndSeconds, chapterRewardPoints } from "./chapter-math";
