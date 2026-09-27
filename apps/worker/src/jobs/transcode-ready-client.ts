import type { MediaReadyCallbackRequest } from "@yourtal/contracts/studio/media";
import {
  MEDIA_SERVICE_SIGNATURE_HEADER,
  signMediaServiceRequest,
} from "@yourtal/contracts/studio/media-service-signature";
import type { TranscodeConfig } from "./transcode-config";

/**
 * Calls `POST /internal/studio/media/:assetId/ready` (7.2.b). A non-2xx
 * throws, so pg-boss retries the whole job — safe because both branches of
 * `ready()` (ready and failed) are idempotent on the api side.
 */
export async function callReady(
  config: TranscodeConfig,
  assetId: string,
  body: MediaReadyCallbackRequest,
): Promise<void> {
  const path = `/api/internal/studio/media/${assetId}/ready`;
  const payload = JSON.stringify(body);
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [MEDIA_SERVICE_SIGNATURE_HEADER]: signMediaServiceRequest({
        secret: config.serviceSecret,
        method: "POST",
        pathAndQuery: path,
        body: payload,
      }),
    },
    body: payload,
  });
  if (!response.ok) {
    throw new Error(
      `ready callback for ${assetId} answered ${String(response.status)}: ${await response.text()}`,
    );
  }
}
