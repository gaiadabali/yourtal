import * as z from "zod";

/**
 * The self-hosted media pipeline (TASKS.md 7.2, replaces Cloudflare Stream).
 * A business uploads a video for a campaign draft it already owns; the
 * worker transcodes it and the studio module records the result here.
 */

export const mediaAssetStatusSchema = z.enum([
  "uploading",
  "queued",
  "processing",
  "ready",
  "failed",
]);
export type MediaAssetStatus = z.infer<typeof mediaAssetStatusSchema>;

/** 7.2.a's "size and type limits". */
export const MEDIA_UPLOAD_ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;
export const MEDIA_UPLOAD_MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
/** S3's own floor for every part but the last. */
export const MEDIA_UPLOAD_PART_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

export const initiateMediaUploadRequestSchema = z.object({
  campaignId: z.uuid(),
  filename: z.string().min(1).max(255),
  contentType: z.enum(MEDIA_UPLOAD_ALLOWED_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(MEDIA_UPLOAD_MAX_SIZE_BYTES),
  /** Where the vertical teaser is cut from, for a 9:16 source (F7/7.2.b). */
  teaserStartSeconds: z.number().int().min(0).default(0),
});
export type InitiateMediaUploadRequest = z.infer<typeof initiateMediaUploadRequestSchema>;

export const mediaUploadPartSchema = z.object({
  partNumber: z.number().int().positive(),
  url: z.url(),
});
export type MediaUploadPart = z.infer<typeof mediaUploadPartSchema>;

export const initiateMediaUploadResponseSchema = z.object({
  assetId: z.uuid(),
  uploadId: z.string().min(1),
  partSizeBytes: z.number().int().positive(),
  parts: z.array(mediaUploadPartSchema).min(1),
});
export type InitiateMediaUploadResponse = z.infer<typeof initiateMediaUploadResponseSchema>;

export const completeMediaUploadPartSchema = z.object({
  partNumber: z.number().int().positive(),
  eTag: z.string().min(1),
});

export const completeMediaUploadRequestSchema = z.object({
  parts: z.array(completeMediaUploadPartSchema).min(1),
});
export type CompleteMediaUploadRequest = z.infer<typeof completeMediaUploadRequestSchema>;

export const mediaRenditionBytesSchema = z.object({
  v360: z.number().int().positive(),
  v540: z.number().int().positive(),
  v720: z.number().int().positive(),
});
export type MediaRenditionBytes = z.infer<typeof mediaRenditionBytesSchema>;

export const mediaAssetSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  campaignId: z.uuid(),
  status: mediaAssetStatusSchema,
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  teaserStartSeconds: z.number().int().min(0),
  durationSeconds: z.number().int().positive().nullable(),
  aspect: z.string().nullable(),
  posterUrl: z.string().nullable(),
  teaserUrl: z.string().nullable(),
  hlsUrl: z.string().nullable(),
  captionsUrl: z.string().nullable(),
  /** 13.9.c: a business-uploaded .vtt, the fallback when the video has no subtitle stream. */
  sidecarCaptionsUrl: z.string().nullable().default(null),
  renditionBytes: mediaRenditionBytesSchema.nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

/**
 * `POST /internal/studio/media/:assetId/ready` (worker -> api). Never
 * touches `campaign.campaigns` itself in the worker; this is what the
 * studio module writes the campaign's media columns FROM (7.2.b).
 */
export const mediaReadyCallbackRequestSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    durationSeconds: z.number().int().positive(),
    aspect: z.string().min(1),
    posterUrl: z.string().min(1),
    teaserUrl: z.string().min(1),
    hlsUrl: z.string().min(1),
    captionsUrl: z.string().min(1).nullable(),
    renditionBytes: mediaRenditionBytesSchema,
  }),
  z.object({
    status: z.literal("failed"),
    failureReason: z.string().min(1),
  }),
]);
export type MediaReadyCallbackRequest = z.infer<typeof mediaReadyCallbackRequestSchema>;

/**
 * The pg-boss queue `apps/api`'s `MediaService.complete()` sends to and
 * `apps/worker/src/jobs/transcode.ts` (7.2.b) consumes — the one queue this
 * API process itself produces to (every other job is worker-to-worker), the
 * same precedent `/dev/clock`'s "run job now" sets for a dev-only queue.
 */
export const MEDIA_TRANSCODE_QUEUE = "studio.media_transcode";

export const mediaTranscodeJobSchema = z.object({
  assetId: z.uuid(),
  rawObjectKey: z.string().min(1),
  teaserStartSeconds: z.number().int().min(0),
});
export type MediaTranscodeJob = z.infer<typeof mediaTranscodeJobSchema>;

/** 13.9.c: the most a sidecar caption file may be (an hour of dense cues is far less). */
export const MAX_SIDECAR_CAPTIONS_BYTES = 512 * 1024;

/** `PUT /api/{tenantId}/studio/media/{assetId}/captions`: a WebVTT file's text. */
export const uploadSidecarCaptionsRequestSchema = z.object({
  vtt: z
    .string()
    .max(MAX_SIDECAR_CAPTIONS_BYTES)
    .refine((text) => /^\uFEFF?WEBVTT(?:[ \t].*)?(?:\r?\n|$)/.test(text), {
      message: "a WebVTT file starts with WEBVTT",
    })
    .refine((text) => /\d{2}:\d{2}(?::\d{2})?\.\d{3}\s+-->\s+\d{2}:\d{2}/.test(text), {
      message: "a WebVTT file needs at least one cue",
    }),
});
export type UploadSidecarCaptionsRequest = z.infer<typeof uploadSidecarCaptionsRequestSchema>;
