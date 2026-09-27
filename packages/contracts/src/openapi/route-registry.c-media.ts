import {
  FORBIDDEN,
  SERVICE_UNAVAILABLE,
  VALIDATION_400,
  TENANT_ID_PARAM,
  nestDefaultError,
  ref,
  type RouteDefinition,
  type RoutePathParam,
} from "./route-registry-shared";

/**
 * Area C's studio media-pipeline routes (TASKS.md 7.2), split out of
 * `route-registry.c.ts` into its own file for the same reason
 * `schema-registry-studio.ts` is split from `schema-registry-business.ts`:
 * that file is already at its line ceiling, and this keeps my own module's
 * routes out of the file a sibling session (business/campaign authoring,
 * 7.1/7.3) is also editing in this phase split.
 *
 * `POST /api/internal/studio/media/{assetId}/ready` is NOT here — see
 * `route-drift.test.ts`'s `KNOWN_OUT_OF_SCOPE`, same reasoning as
 * `GET /api/internal/hls-auth`.
 */

const ASSET_ID_PARAM: RoutePathParam = {
  name: "assetId",
  description: "The media asset being uploaded to or read.",
  schema: { type: "string", format: "uuid" },
};

const ASSET_NOT_FOUND = nestDefaultError(
  404,
  "No media asset exists with this id for this tenant.",
);
const INVALID_STATE = nestDefaultError(
  409,
  "The asset is not in the state this action requires (e.g. completing an already-completed upload).",
);

export const STUDIO_MEDIA_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "post",
    path: "/api/{tenantId}/studio/media/initiate",
    summary: "Start a presigned multipart upload of a campaign's video",
    tags: ["studio", "media"],
    pathParams: [TENANT_ID_PARAM],
    requestBody: {
      description: "The file's declared size and type, and the campaign it is for.",
      schema: ref("InitiateMediaUploadRequest"),
    },
    successStatus: 201,
    successDescription: "The asset id and one presigned PUT URL per part.",
    successSchema: ref("InitiateMediaUploadResponse"),
    errors: [VALIDATION_400, FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/{tenantId}/studio/media/{assetId}/complete",
    summary: "Finish the multipart upload and queue the transcode",
    tags: ["studio", "media"],
    pathParams: [TENANT_ID_PARAM, ASSET_ID_PARAM],
    requestBody: {
      description: "Each part's ETag, as MinIO returned it from the client's PUT.",
      schema: ref("CompleteMediaUploadRequest"),
    },
    successStatus: 200,
    successDescription: 'The asset, now in "queued" status.',
    successSchema: ref("MediaAsset"),
    errors: [VALIDATION_400, FORBIDDEN, ASSET_NOT_FOUND, INVALID_STATE, SERVICE_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/{tenantId}/studio/media/{assetId}",
    summary: "Poll a media asset while the worker transcodes it",
    tags: ["studio", "media"],
    pathParams: [TENANT_ID_PARAM, ASSET_ID_PARAM],
    successStatus: 200,
    successDescription: "The asset's current status and, once ready, its renditions.",
    successSchema: ref("MediaAsset"),
    errors: [FORBIDDEN, ASSET_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
];
