import { bigint, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { MediaAssetStatus, MediaRenditionBytes } from "@yourtal/contracts/studio/media";
import { studioPgSchema } from "./studio-schema";

/**
 * `studio.media_assets`, as the migration defines it (TASKS.md 7.2). No FK
 * import from `business.business_accounts`/`campaign.campaigns`: those
 * tables belong to a different session's files in this phase split, and the
 * migration itself already declares the real foreign keys — Drizzle's view
 * here only needs the column, not the reference, the same way
 * `kyb-document.table.ts` references `businessAccounts` only because it
 * lives in the SAME module. `raw_object_key` and `upload_id` are internal
 * write-side bookkeeping (see `schema-drift.test.ts`'s note on them) and are
 * still modelled here because the repository needs to read them back to
 * hand the worker a job.
 */
export const mediaAssets = studioPgSchema.table("media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  status: text("status").notNull().$type<MediaAssetStatus>(),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  rawObjectKey: text("raw_object_key").notNull(),
  uploadId: text("upload_id").notNull(),
  teaserStartSeconds: integer("teaser_start_seconds").notNull().default(0),
  durationSeconds: integer("duration_seconds"),
  aspect: text("aspect"),
  posterUrl: text("poster_url"),
  teaserUrl: text("teaser_url"),
  hlsUrl: text("hls_url"),
  captionsUrl: text("captions_url"),
  // 13.9.c (sidecar_captions_url).
  sidecarCaptionsUrl: text("sidecar_captions_url"),
  renditionBytes: jsonb("rendition_bytes").$type<MediaRenditionBytes>(),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
