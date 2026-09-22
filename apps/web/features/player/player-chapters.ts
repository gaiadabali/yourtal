import type { Campaign } from "@yourtal/contracts/campaign";
import { chapterEndSeconds, chapterRewardPoints } from "@yourtal/contracts/campaign/chapter";

/**
 * The player's view of a campaign's chapters, projected from the contract
 * (YT-0584, closing YT-0503's deferred criterion).
 *
 * ## What this replaces
 *
 * `derive-chapters.ts` **invented** chapters: it split `durationSeconds`
 * into five even segments and allocated reward across a hard-coded
 * `[1,1,1,2,5]` weight set, because — as its own comment said —
 * "`packages/contracts` has no chapter data yet". That stopped being true
 * when YT-0503 added `chapters: z.array(campaignChapterSchema)` to
 * `campaignSchema`, with a refine that a long-form campaign must have some.
 * The comment outlived the gap it described, which is why the player was
 * still showing five invented segments for a campaign that carried its own.
 *
 * `chapter.ts` declared a second `Chapter` interface alongside the
 * contract's `CampaignChapter`. Two definitions of one shape is how they
 * drift — the argument YT-0510 makes generally, applied here.
 *
 * ## Why a projection is not a third definition
 *
 * The contract stores only what a campaign *has*: `title`, `startSeconds`,
 * `rewardWeight`. The player additionally needs each chapter's **end** and
 * its **points**, both of which are derivations over the whole list plus the
 * campaign's duration and total reward. Those derivations live in the
 * contract (`chapterEndSeconds`, `chapterRewardPoints`); this module only
 * applies them and attaches the index the UI keys on.
 *
 * So nothing here defines chapter data — remove a field from
 * `campaignChapterSchema` and this stops compiling, which is the property
 * the old duplicate did not have.
 *
 * ⏭️ `rewardPoints` per chapter is display-only pacing, never a discrete
 * grant. Whether the back-loaded distribution should exist at all is
 * YT-0124's open question under founder decision O-1 (one grant after the
 * full video and the questions, leaving nothing partial to allocate). This
 * module reads whatever weights the campaign carries rather than pinning a
 * worked example, deliberately: pinning it would make YT-0124's honest
 * outcome look like a coverage regression.
 */
export interface PlayerChapter {
  readonly index: number;
  readonly title: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  /** Pacing weight for the progress bar only, in whole points. */
  readonly rewardPoints: number;
}

export type ChapterSourceCampaign = Pick<Campaign, "chapters" | "durationSeconds" | "rewardPoints">;

export function playerChapters(campaign: ChapterSourceCampaign): PlayerChapter[] {
  const points = chapterRewardPoints(campaign.chapters, Number(campaign.rewardPoints));

  return campaign.chapters.map((chapter, index) => ({
    index,
    title: chapter.title,
    startSeconds: chapter.startSeconds,
    endSeconds: chapterEndSeconds(campaign.chapters, index, campaign.durationSeconds),
    rewardPoints: points[index] ?? 0,
  }));
}
