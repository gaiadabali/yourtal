import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
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
  // A business declares an intended length at draft creation; 7.2's
  // transcode reconciles the real one later. Unlike the columns below, this
  // one is never absent, only provisional — so it stays NOT NULL.
  durationSeconds: integer("duration_seconds").notNull(),
  // The following are nullable from TASKS.md 7.3 onward: a fresh DRAFT has
  // no video (7.2 attaches these later, asynchronously) and no reward
  // config (7.3.c is a separate step). Required once lifecycle_state
  // leaves 'draft' — enforced by campaigns_media_required_past_draft and
  // campaigns_reward_required_past_draft (20260927140000), not by NOT NULL.
  estimatedDataMb: numeric("estimated_data_mb"),
  rewardPoints: integer("reward_points"),
  questionCount: integer("question_count"),
  scoringRule: text("scoring_rule"),
  /** The AUTHORING state. Never served to a viewer — see the repository. */
  lifecycleState: text("lifecycle_state").notNull(),
  rejectionReason: text("rejection_reason"),
  // Set exactly once, by campaign.assert_lifecycle_transition(), the moment
  // lifecycle_state first becomes 'live'. Null for a draft/in_review/
  // rejected campaign — see campaigns_published_at_iff_live_or_past.
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // TASKS.md 1.1.a.
  businessId: uuid("business_id").notNull(),
  region: text("region").notNull(),
  audience: text("audience").notNull(),
  contentCategory: text("content_category").notNull(),
  posterUrl: text("poster_url"),
  teaserUrl: text("teaser_url"),
  hlsUrl: text("hls_url"),
  captionsUrl: text("captions_url"),
  aspect: text("aspect"),
  estimatedBytes: bigint("estimated_bytes", { mode: "number" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  openViewing: boolean("open_viewing").notNull().default(false),
  teaserStartSeconds: integer("teaser_start_seconds").notNull().default(0),
  // 7.7's feed ranking: interest-taxonomy node ids this campaign targets,
  // matched against a viewer's OWN declared interests — never the reverse
  // inference red line 6 forbids. Validated against
  // packages/contracts/src/interest/taxonomy.ts's isKnownInterestNode at the
  // app layer (20260927140000).
  declaredInterests: jsonb("declared_interests").notNull().default([]),
  // Authoring input: which second of the source video the poster is grabbed
  // from. Distinct from posterUrl, the rendered image the media pipeline
  // produces once that second is known. Null until a video exists.
  posterFrameSeconds: integer("poster_frame_seconds"),
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
  /** Frozen alongside the other reward-affecting fields (TASKS.md 1.1.f). */
  accuracyBonusPoints: bigint("accuracy_bonus_points", { mode: "number" }).notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
});

/**
 * `campaign.reward_config` (20260920000012). No Drizzle mirror existed
 * before TASKS.md 7.3 — B's viewer-facing repository reads it through raw
 * SQL specifically because this table is Studio's (this file's own
 * `campaign/persistence/schema/**` ownership), and this is where it
 * finally gets one.
 */
export const campaignRewardConfigs = campaignPgSchema.table("reward_config", {
  campaignId: uuid("campaign_id").primaryKey(),
  allocationId: text("allocation_id").notNull(),
  funderType: text("funder_type").notNull(),
  maxPointsForCampaign: bigint("max_points_for_campaign", { mode: "number" }).notNull(),
  rewardPointsPerCompletion: bigint("reward_points_per_completion", { mode: "number" }).notNull(),
  accuracyBonusPoints: bigint("accuracy_bonus_points", { mode: "number" }).notNull(),
});
