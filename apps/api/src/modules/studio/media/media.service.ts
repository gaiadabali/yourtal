import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PgBoss } from "pg-boss";
import type {
  CompleteMediaUploadRequest,
  InitiateMediaUploadRequest,
  InitiateMediaUploadResponse,
  MediaAsset,
  MediaReadyCallbackRequest,
  MediaTranscodeJob,
} from "@yourtal/contracts/studio/media";
import {
  MEDIA_TRANSCODE_QUEUE,
  MEDIA_UPLOAD_PART_SIZE_BYTES,
} from "@yourtal/contracts/studio/media";
import { completeRawUpload, createMediaClient, createRawUpload } from "@yourtal/media/studio-media";
import { defineQueue } from "@yourtal/queue/define-queue";
import {
  MEDIA_ASSET_REPOSITORY,
  type MediaAssetRecord,
  type MediaAssetRepository,
} from "./persistence/media-asset.repository";

export const MEDIA_QUEUE_CLIENT = Symbol("MEDIA_QUEUE_CLIENT");

export type MediaServiceError =
  { readonly kind: "not_found" } | { readonly kind: "invalid_state"; readonly reason: string };

function extensionFor(contentType: string): string {
  if (contentType === "video/mp4") return "mp4";
  if (contentType === "video/quicktime") return "mov";
  return "webm";
}

function toPublicAsset(record: MediaAssetRecord): MediaAsset {
  // rawObjectKey/uploadId are write-side bookkeeping (schema-drift.test.ts's
  // note on them) -- never handed back to a client.
  const { rawObjectKey: _rawObjectKey, uploadId: _uploadId, ...publicFields } = record;
  return publicFields;
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
    @Inject(MEDIA_QUEUE_CLIENT) private readonly boss: PgBoss,
  ) {}

  async initiate(
    businessId: string,
    input: InitiateMediaUploadRequest,
  ): Promise<InitiateMediaUploadResponse> {
    const assetId = randomUUID();
    const client = createMediaClient();
    const partCount = Math.max(1, Math.ceil(input.sizeBytes / MEDIA_UPLOAD_PART_SIZE_BYTES));
    const upload = await createRawUpload(client, {
      assetId,
      extension: extensionFor(input.contentType),
      contentType: input.contentType,
      partCount,
    });
    client.destroy();

    await this.assets.create({
      id: assetId,
      businessId,
      campaignId: input.campaignId,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      rawObjectKey: upload.key,
      uploadId: upload.uploadId,
      teaserStartSeconds: input.teaserStartSeconds,
    });

    return {
      assetId,
      uploadId: upload.uploadId,
      partSizeBytes: MEDIA_UPLOAD_PART_SIZE_BYTES,
      parts: [...upload.parts],
    };
  }

  async complete(
    businessId: string,
    assetId: string,
    input: CompleteMediaUploadRequest,
  ): Promise<
    | { readonly ok: true; readonly asset: MediaAsset }
    | { readonly ok: false; readonly error: MediaServiceError }
  > {
    const record = await this.assets.findByIdForBusiness(assetId, businessId);
    if (record === null) return { ok: false, error: { kind: "not_found" } };
    // Idempotent: a retried `complete` (network blip after the first call
    // actually succeeded) finds the asset already past "uploading" and
    // replays that success rather than erroring — same reasoning as
    // `ready()`'s own terminal-state check below.
    if (record.status !== "uploading") {
      return { ok: true, asset: toPublicAsset(record) };
    }

    const client = createMediaClient();
    await completeRawUpload(client, {
      key: record.rawObjectKey,
      uploadId: record.uploadId,
      parts: input.parts,
    });
    client.destroy();

    await this.assets.markQueued(assetId);
    // `id: assetId` makes this send idempotent under pg-boss's own primary
    // key: a retried `complete` call (CLAUDE.md's "assume every webhook
    // fires twice") re-sends the identical job id and pg-boss drops the
    // duplicate rather than transcoding twice.
    const job: MediaTranscodeJob = {
      assetId,
      rawObjectKey: record.rawObjectKey,
      teaserStartSeconds: record.teaserStartSeconds,
    };
    // Defensive, same reasoning as `/dev/clock`'s `runJob`: the worker's own
    // boot defines every queue it loads, but this send may be the first one
    // to ever happen against a fresh database.
    await defineQueue(this.boss, MEDIA_TRANSCODE_QUEUE);
    const jobId = await this.boss.send(MEDIA_TRANSCODE_QUEUE, job, { id: assetId });
    if (jobId === null) {
      throw new Error(`pg-boss refused to enqueue a job on "${MEDIA_TRANSCODE_QUEUE}"`);
    }
    const updated = await this.assets.findById(assetId);
    return { ok: true, asset: toPublicAsset(updated ?? record) };
  }

  async get(businessId: string, assetId: string): Promise<MediaAsset | null> {
    const record = await this.assets.findByIdForBusiness(assetId, businessId);
    return record === null ? null : toPublicAsset(record);
  }

  /** `POST /internal/studio/media/:assetId/ready` — the worker's callback (7.2.b). Idempotent. */
  async ready(
    assetId: string,
    input: MediaReadyCallbackRequest,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: MediaServiceError }> {
    const record = await this.assets.findById(assetId);
    if (record === null) return { ok: false, error: { kind: "not_found" } };

    // Idempotent: a re-delivered "ready" or "failed" for an asset already in
    // that terminal state is a no-op success, not an error (CLAUDE.md's
    // "assume every webhook fires twice").
    if (record.status === "ready" || record.status === "failed") {
      return { ok: true };
    }

    if (input.status === "failed") {
      await this.assets.markFailed(assetId, input.failureReason);
      return { ok: true };
    }

    const updated = await this.assets.markReady(assetId, {
      durationSeconds: input.durationSeconds,
      aspect: input.aspect,
      posterUrl: input.posterUrl,
      teaserUrl: input.teaserUrl,
      hlsUrl: input.hlsUrl,
      captionsUrl: input.captionsUrl,
      renditionBytes: input.renditionBytes,
    });
    // TASKS.md 7.2.b: "the studio module writes the campaign's media
    // columns" -- never the worker, which only reports what it produced.
    await this.assets.writeCampaignMedia(updated.campaignId, {
      posterUrl: input.posterUrl,
      teaserUrl: input.teaserUrl,
      hlsUrl: input.hlsUrl,
      captionsUrl: input.captionsUrl,
    });
    return { ok: true };
  }
}
