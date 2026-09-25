import { z } from "zod";
import { contentCategorySchema } from "@yourtal/jurisdiction/content-category";
import { pointsSchema } from "../money/money";
import { regionSchema } from "../region/region";
import { audienceSchema } from "../audience/audience";
import { campaignChapterSchema } from "./campaign-chapter";
import { campaignVideoSourceSchema } from "./campaign-video-source";

// Re-exported here (rather than added to packages/contracts/package.json's
// exports map, which 1.3.a is about to restructure into a wildcard) so B and
// C can reach it as `@yourtal/contracts/campaign` today.
export { audienceSchema, reachesAudience, isBoostedForParents } from "../audience/audience";
export type { Audience, AgeBand, AudienceReachContext } from "../audience/audience";

/**
 * A campaign is the earn-loop unit: a video a user watches for points,
 * shaped either as a long-form entry (docs/17 "Earn" surface) or a short
 * "Quick" feed item (docs/17 section 1.1). The entry card contract
 * (docs/tasks/phase-u-ui.md YT-0411) requires duration, reward, data cost
 * and question count to always be present and honest — none of these are
 * optional here.
 *
 * `chapters` and `videoSource` (YT-0503) replace what Phase U's player left
 * as local, commented fakes — see `campaign-chapter.ts` and
 * `campaign-video-source.ts` for why each is shaped the way it is.
 */
export const campaignKindSchema = z.enum(["long_form", "quick"]);
export type CampaignKind = z.infer<typeof campaignKindSchema>;

export const campaignScoringRuleSchema = z.enum(["base_only", "base_plus_accuracy_bonus"]);
export type CampaignScoringRule = z.infer<typeof campaignScoringRuleSchema>;

export const campaignStatusSchema = z.enum(["active", "paused", "ended"]);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

const MAX_DURATION_SECONDS = 3 * 60 * 60; // 3 hours, a generous ceiling for long-form
const MAX_ESTIMATED_DATA_MB = 2_000;
// F10 caps how many questions a session ever asks at 5
// (`questionsAskedFor`, ../question/question-bank.ts). This field IS that
// asked count (frozen per session onto `campaignTermsSchema`), so its ceiling
// must agree — TASKS.md 1.1.f. It was 20 before F10 was decided; nothing
// seeded or tested ever used a value above 6, so tightening it is a pure
// narrowing.
const MAX_QUESTION_COUNT = 5;
const MAX_MERCHANT_NAME_LENGTH = 120;
const ASPECT_RATIOS = ["16:9", "9:16"] as const;

export const campaignSchema = z
  .object({
    id: z.uuid(),
    kind: campaignKindSchema,
    title: z.string().min(1).max(140),
    merchantId: z.uuid(),
    merchantName: z.string().min(1).max(MAX_MERCHANT_NAME_LENGTH),
    synopsis: z.string().min(1).max(500),
    durationSeconds: z.number().int().positive().max(MAX_DURATION_SECONDS),
    estimatedDataMb: z.number().positive().max(MAX_ESTIMATED_DATA_MB),
    rewardPoints: pointsSchema,
    questionCount: z.number().int().min(0).max(MAX_QUESTION_COUNT),
    scoringRule: campaignScoringRuleSchema,
    status: campaignStatusSchema,
    publishedAt: z.iso.datetime(),
    chapters: z.array(campaignChapterSchema),
    videoSource: campaignVideoSourceSchema,
    /** The business running this campaign. TASKS.md 1.1.a. */
    businessId: z.uuid(),
    /** Immutable per business (`businessSchema.region`); every account, rate and job stays inside it (F2). */
    region: regionSchema,
    audience: audienceSchema,
    contentCategory: contentCategorySchema,
    /** Feed and card image, shown before any video loads. */
    posterUrl: z.url(),
    /** A progressive MP4, autoplayed muted in the vertical feed (docs/17, 3.5.a). */
    teaserUrl: z.url(),
    /**
     * Convenience mirror of `videoSource`'s manifest for the `hls` kind. Kept
     * alongside rather than replacing `videoSource` — `videoSource` stays the
     * canonical, extensible (discriminated-union) source, and a future
     * non-hls member does not retroactively make this field a lie because the
     * player never needs to fall back to it once one exists.
     */
    hlsUrl: z.url(),
    /** A WebVTT track, or `null` until one is authored (3.5.b's CC toggle). */
    captionsUrl: z.url().nullable(),
    aspect: z.enum(ASPECT_RATIOS),
    /** Byte-precise sibling of `estimatedDataMb`, for a data-cost estimate that does not round-trip through megabytes. */
    estimatedBytes: z.number().int().positive(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    /** F8: only an opted-in, all-ages campaign may ever play logged out. Off by default. */
    openViewing: z.boolean().default(false),
    /** Where the vertical teaser clip starts within the full video. */
    teaserStartSeconds: z.number().int().min(0).default(0),
  })
  .refine((campaign) => campaign.kind !== "quick" || campaign.durationSeconds <= 60, {
    message: "A quick campaign must be 60 seconds or shorter (docs/17 section 1.1)",
    path: ["durationSeconds"],
  })
  .refine((campaign) => campaign.kind !== "long_form" || campaign.chapters.length > 0, {
    // Stated rather than left permissive. `z.array()` allowed an empty list
    // by omission, and a long-form campaign with no chapters has no progress
    // markers at all — the seek bar and the chapter track both render
    // nothing, which reads as a broken player rather than as bad data.
    message: "A long-form campaign must have at least one chapter",
    path: ["chapters"],
  })
  .refine((campaign) => campaign.kind !== "quick" || campaign.chapters.length === 0, {
    // And the other direction, which is the half that would have been
    // missed. A quick campaign is sixty seconds; chapters on one are
    // navigation furniture for a video with nowhere to navigate. The seeded
    // catalogue already splits exactly this way (long_form 5, quick 0), so
    // this records an existing rule rather than imposing a new one.
    message: "A quick campaign is too short to have chapters",
    path: ["chapters"],
  })
  .refine(
    (campaign) => campaign.scoringRule !== "base_plus_accuracy_bonus" || campaign.questionCount > 0,
    {
      message: "An accuracy bonus requires at least one question to score accuracy against",
      path: ["scoringRule"],
    },
  )
  .refine((campaign) => (campaign.kind === "long_form") === campaign.chapters.length > 0, {
    message: "A long_form campaign must have at least one chapter; a quick campaign has none",
    path: ["chapters"],
  })
  .refine(
    (campaign) => campaign.chapters.length === 0 || campaign.chapters[0]?.startSeconds === 0,
    { message: "The first chapter must start at second 0", path: ["chapters"] },
  )
  .refine(
    (campaign) =>
      campaign.chapters.every(
        (chapter, index) =>
          index === 0 || chapter.startSeconds > (campaign.chapters[index - 1]?.startSeconds ?? -1),
      ),
    {
      message: "Chapter start times must be strictly increasing",
      path: ["chapters"],
    },
  )
  .refine(
    (campaign) =>
      campaign.chapters.length === 0 ||
      (campaign.chapters.at(-1)?.startSeconds ?? 0) < campaign.durationSeconds,
    {
      message: "Every chapter must start before the campaign's own durationSeconds",
      path: ["chapters"],
    },
  )
  .refine((campaign) => new Date(campaign.endsAt) > new Date(campaign.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  })
  .refine((campaign) => campaign.teaserStartSeconds < campaign.durationSeconds, {
    message: "teaserStartSeconds must be before the campaign ends",
    path: ["teaserStartSeconds"],
  });

export type Campaign = z.infer<typeof campaignSchema>;
