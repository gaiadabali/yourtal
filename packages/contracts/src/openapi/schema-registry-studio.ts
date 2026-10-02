import {
  mediaAssetSchema,
  uploadSidecarCaptionsRequestSchema,
  mediaAssetStatusSchema,
  mediaRenditionBytesSchema,
  initiateMediaUploadRequestSchema,
  initiateMediaUploadResponseSchema,
  mediaUploadPartSchema,
  completeMediaUploadRequestSchema,
  completeMediaUploadPartSchema,
} from "../studio/media";
import type { ContractComponent } from "./schema-registry";

/**
 * The studio media-pipeline half of `CONTRACT_COMPONENTS` (TASKS.md 7.2),
 * split out for the same reason `schema-registry-business.ts` is: keep
 * `schema-registry.ts` under its line ceiling as new domains are added.
 *
 * `mediaReadyCallbackRequestSchema` (the worker -> api internal callback) is
 * NOT here, same reasoning as the ledger-internal/voucher-internal types in
 * `openapi.test.ts`'s `NOT_PUBLISHED`: it is a loopback service-to-service
 * shape, never a `/api/:tenantId/*` route a browser calls.
 */
export const STUDIO_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "MediaAssetStatus",
    schema: mediaAssetStatusSchema,
    description: "Where an uploaded video is in the pipeline (TASKS.md 7.2).",
    crossFieldRules: [],
  },
  {
    id: "MediaRenditionBytes",
    schema: mediaRenditionBytesSchema,
    description:
      "Bytes produced per HLS rendition; campaign.campaigns.estimatedBytes is defined against v540.",
    crossFieldRules: [],
  },
  {
    id: "InitiateMediaUploadRequest",
    schema: initiateMediaUploadRequestSchema,
    description:
      "Starts a presigned multipart upload of a campaign's video, to the object store's raw/ prefix.",
    crossFieldRules: [],
  },
  {
    id: "MediaUploadPart",
    schema: mediaUploadPartSchema,
    description: "One presigned PUT URL for one part of the multipart upload.",
    crossFieldRules: [],
  },
  {
    id: "InitiateMediaUploadResponse",
    schema: initiateMediaUploadResponseSchema,
    description: "The asset id and every part URL the client PUTs its bytes to, in order.",
    crossFieldRules: [],
  },
  {
    id: "CompleteMediaUploadPart",
    schema: completeMediaUploadPartSchema,
    description: "One part's ETag, as the object store returned it from the client's PUT.",
    crossFieldRules: [],
  },
  {
    id: "CompleteMediaUploadRequest",
    schema: completeMediaUploadRequestSchema,
    description:
      "Finishes the multipart upload and queues the transcode job (TASKS.md 7.2.a/7.2.b).",
    crossFieldRules: [],
  },
  {
    id: "MediaAsset",
    schema: mediaAssetSchema,
    description:
      "One uploaded video and its transcoded renditions, for Studio to poll while the worker " +
      'processes it. status "ready" implies posterUrl/teaserUrl/hlsUrl are all set and status ' +
      '"failed" implies failureReason is set -- both enforced by the DB CHECKs in ' +
      "studio.media_assets, not by a zod .refine() here, so crossFieldRules stays empty.",
    crossFieldRules: [],
  },
  {
    id: "UploadSidecarCaptionsRequest",
    schema: uploadSidecarCaptionsRequestSchema,
    description:
      "13.9.c: a business's own WebVTT file, up to 512 KB, used when the video has no subtitle stream.",
    crossFieldRules: [],
  },
];
