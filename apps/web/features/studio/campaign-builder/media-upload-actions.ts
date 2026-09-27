"use server";

import {
  completeMediaUploadRequestSchema,
  initiateMediaUploadRequestSchema,
  initiateMediaUploadResponseSchema,
  mediaAssetSchema,
} from "@yourtal/contracts/studio/media";
import type {
  CompleteMediaUploadRequest,
  InitiateMediaUploadResponse,
  MediaAsset,
} from "@yourtal/contracts/studio/media";
import { apiFetch } from "@/lib/api/api-fetch";

export type MediaActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * Looser than `InitiateMediaUploadRequest` on purpose: `file.type` (the
 * browser's own MIME sniff) is a plain `string`, not the contract's closed
 * `contentType` enum, so the client cannot construct the strict type at
 * all. `initiateMediaUploadRequestSchema.safeParse` below is the real
 * check; an unsupported type fails there with a clear message instead of
 * this function refusing to compile against real browser input.
 */
export interface InitiateMediaUploadInput {
  campaignId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  teaserStartSeconds: number;
}

/**
 * Server Actions wrapping 7.2's real media endpoints (task 7.8.b's real
 * upload). The actual bytes never pass through this server: this only
 * starts and finishes the upload — `campaign-editor-upload.tsx` PUTs each
 * part straight from the browser to the presigned MinIO URLs this
 * `initiate` call returns, exactly what a presigned multipart upload is
 * for. Every result is a plain serialisable object (never a thrown
 * exception across the server/client boundary), so the client component
 * can show a real, specific failure instead of a generic Next.js error
 * overlay.
 */
export async function initiateMediaUploadAction(
  businessId: string,
  input: InitiateMediaUploadInput,
): Promise<MediaActionResult<InitiateMediaUploadResponse>> {
  const parsed = initiateMediaUploadRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.path[0] === "contentType"
          ? "That video format isn't supported (mp4, mov or webm only)."
          : "Invalid upload request.",
    };
  }

  const result = await apiFetch(
    `/api/${businessId}/studio/media/initiate`,
    initiateMediaUploadResponseSchema,
    { method: "POST", body: parsed.data },
  );
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, data: result.data };
}

export async function completeMediaUploadAction(
  businessId: string,
  assetId: string,
  input: CompleteMediaUploadRequest,
): Promise<MediaActionResult<MediaAsset>> {
  const parsed = completeMediaUploadRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid completion request." };

  const result = await apiFetch(
    `/api/${businessId}/studio/media/${assetId}/complete`,
    mediaAssetSchema,
    {
      method: "POST",
      body: parsed.data,
    },
  );
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, data: result.data };
}

export async function getMediaAssetAction(
  businessId: string,
  assetId: string,
): Promise<MediaActionResult<MediaAsset>> {
  const result = await apiFetch(`/api/${businessId}/studio/media/${assetId}`, mediaAssetSchema);
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, data: result.data };
}
