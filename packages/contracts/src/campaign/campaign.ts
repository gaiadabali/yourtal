import { z } from "zod";
import { pointsSchema } from "../money/money";

/**
 * A campaign is the earn-loop unit: a video a user watches for points,
 * shaped either as a long-form entry (docs/17 "Earn" surface) or a short
 * "Quick" feed item (docs/17 section 1.1). The entry card contract
 * (docs/tasks/phase-u-ui.md YT-0411) requires duration, reward, data cost
 * and question count to always be present and honest — none of these are
 * optional here.
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
  })
  .refine((campaign) => campaign.kind !== "quick" || campaign.durationSeconds <= 60, {
    message: "A quick campaign must be 60 seconds or shorter (docs/17 section 1.1)",
    path: ["durationSeconds"],
  })
  .refine(
    (campaign) => campaign.scoringRule !== "base_plus_accuracy_bonus" || campaign.questionCount > 0,
    {
      message: "An accuracy bonus requires at least one question to score accuracy against",
      path: ["scoringRule"],
    },
  );

export type Campaign = z.infer<typeof campaignSchema>;
