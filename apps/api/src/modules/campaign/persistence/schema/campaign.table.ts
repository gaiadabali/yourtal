import { integer, numeric, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaignPgSchema } from "./campaign-schema";

/**
 * `campaign.campaigns`, as the migration defines it.
 *
 * Note what is NOT here: a `status` column. It was dropped by YT-0101 and the
 * viewer-facing status is derived from `lifecycle_state` through
 * `publicStatusOf`. A Drizzle table declaring `status` would compile and then
 * fail at runtime — which is exactly the class of drift the
 * contracts/migrations gate catches for Zod and cannot catch here.
 */
export const campaigns = campaignPgSchema.table("campaigns", {
  id: uuid("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  merchantId: uuid("merchant_id").notNull(),
  merchantName: text("merchant_name").notNull(),
  synopsis: text("synopsis").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  estimatedDataMb: numeric("estimated_data_mb").notNull(),
  rewardPoints: integer("reward_points").notNull(),
  questionCount: integer("question_count").notNull(),
  scoringRule: text("scoring_rule").notNull(),
  /** The AUTHORING state. Never served to a viewer — see the repository. */
  lifecycleState: text("lifecycle_state").notNull(),
  rejectionReason: text("rejection_reason"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
});

export const campaignChapters = campaignPgSchema.table("chapter", {
  campaignId: uuid("campaign_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  title: text("title").notNull(),
  startSeconds: integer("start_seconds").notNull(),
  rewardWeight: numeric("reward_weight").notNull(),
});

export const campaignVideoSources = campaignPgSchema.table("video_source", {
  campaignId: uuid("campaign_id").primaryKey(),
  kind: text("kind").notNull(),
  manifestUrl: text("manifest_url"),
});

export const campaignTermsVersions = campaignPgSchema.table("terms_version", {
  campaignId: uuid("campaign_id").notNull(),
  version: integer("version").notNull(),
  rewardPoints: integer("reward_points").notNull(),
  questionCount: integer("question_count").notNull(),
  scoringRule: text("scoring_rule").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
});
