import { z } from "zod";
import { pointsSchema } from "../money/money";
import { campaignChapterSchema } from "./campaign-chapter";
import { campaignVideoSourceSchema } from "./campaign-video-source";

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
const MAX_QUESTION_COUNT = 20;
const MAX_MERCHANT_NAME_LENGTH = 120;

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
  );

export type Campaign = z.infer<typeof campaignSchema>;
