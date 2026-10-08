import type { CampaignVideoUpload } from "./campaign-draft";
import {
  completeMediaUploadAction,
  getMediaAssetAction,
  initiateMediaUploadAction,
} from "./media-upload-actions";

/** A part-upload failure with a catalogue code, so the message is worded for the viewer at the end, not here. */
class UploadFailure extends Error {
  constructor(
    readonly code: "partFailed" | "noEtag" | "networkError",
    readonly values: Record<string, number> = {},
  ) {
    super(code);
  }
}

export type UploadT = (key: string, values?: Record<string, number>) => string;

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 150; // 5 minutes at 2s — well past 7.2.f's own ~2-minute Check.

/**
 * PUTs one part straight from the browser to its presigned object-store URL — the
 * whole reason `initiate` hands back a URL per part rather than proxying
 * the bytes through this app's own server. `XMLHttpRequest`, not `fetch`:
 * only `xhr.upload.onprogress` gives real upload-progress events: fetch's
 * `ReadableStream` request body has no equivalent in browsers today.
 */
function putPart(
  url: string,
  chunk: Blob,
  onLoaded: (loadedBytes: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onLoaded(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new UploadFailure("partFailed", { status: xhr.status }));
        return;
      }
      const eTag = xhr.getResponseHeader("ETag");
      if (!eTag) {
        reject(new UploadFailure("noEtag"));
        return;
      }
      resolve(eTag);
    };
    xhr.onerror = () => reject(new UploadFailure("networkError"));
    xhr.send(chunk);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface UploadCampaignVideoParams {
  file: File;
  businessId: string;
  campaignId: string;
  teaserStartSeconds: number;
  onUpdate: (video: CampaignVideoUpload) => void;
  /** The `studio` translator, for the failure messages shown under the file picker. */
  t: UploadT;
}

/**
 * The real upload (task 7.8.b): initiate -> PUT every part (browser to
 * object store directly) -> complete -> poll `GET .../media/:assetId` until the
 * worker's `/ready` callback (7.2.b) lands a terminal status. Every step
 * reports through `onUpdate`, mirroring the old simulated-progress
 * component's own state shape so the rest of the UI needed no other
 * change. A failure at any step is a real, specific `failureReason` —
 * never a silent stall.
 */
export async function uploadCampaignVideo({
  file,
  businessId,
  campaignId,
  teaserStartSeconds,
  onUpdate,
  t,
}: UploadCampaignVideoParams): Promise<void> {
  const fileName = file.name;
  const fail = (message: string) =>
    onUpdate({
      fileName,
      status: "failed",
      progressPercent: 0,
      assetId: null,
      failureReason: message,
    });

  onUpdate({ fileName, status: "uploading", progressPercent: 0, assetId: null });

  const initiated = await initiateMediaUploadAction(businessId, {
    campaignId,
    filename: fileName,
    contentType: file.type,
    sizeBytes: file.size,
    teaserStartSeconds,
  });
  if (!initiated.ok) {
    fail(
      initiated.reason === "unsupported_format"
        ? t("campaignBuilder.upload.errors.unsupportedFormat")
        : initiated.reason === "invalid_request"
          ? t("campaignBuilder.upload.errors.invalidRequest")
          : initiated.message,
    );
    return;
  }
  const { assetId, parts, partSizeBytes } = initiated.data;

  const uploadedParts: { partNumber: number; eTag: string }[] = [];
  let bytesDoneBeforeCurrentPart = 0;
  try {
    for (const part of parts) {
      const start = (part.partNumber - 1) * partSizeBytes;
      const end = Math.min(start + partSizeBytes, file.size);
      const chunk = file.slice(start, end);
      const eTag = await putPart(part.url, chunk, (loadedInPart) => {
        const totalLoaded = bytesDoneBeforeCurrentPart + loadedInPart;
        onUpdate({
          fileName,
          status: "uploading",
          progressPercent: Math.min(99, Math.round((totalLoaded / file.size) * 100)),
          assetId,
        });
      });
      bytesDoneBeforeCurrentPart += chunk.size;
      uploadedParts.push({ partNumber: part.partNumber, eTag });
    }
  } catch (error) {
    fail(
      error instanceof UploadFailure
        ? t(`campaignBuilder.upload.errors.${error.code}`, error.values)
        : t("campaignBuilder.upload.errors.uploadFailed"),
    );
    return;
  }

  onUpdate({ fileName, status: "processing", progressPercent: 100, assetId });

  const completed = await completeMediaUploadAction(businessId, assetId, { parts: uploadedParts });
  if (!completed.ok) {
    fail(
      completed.reason ? t("campaignBuilder.upload.errors.invalidCompletion") : completed.message,
    );
    return;
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);
    const polled = await getMediaAssetAction(businessId, assetId);
    if (!polled.ok) {
      fail(polled.message);
      return;
    }
    if (polled.data.status === "ready") {
      onUpdate({ fileName, status: "ready", progressPercent: 100, assetId });
      return;
    }
    if (polled.data.status === "failed") {
      fail(polled.data.failureReason ?? t("campaignBuilder.upload.errors.transcodeFailed"));
      return;
    }
    // "queued"/"processing" — keep polling.
  }
  fail(t("campaignBuilder.upload.errors.stillProcessing"));
}
