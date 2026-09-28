import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEDIA_TRANSCODE_QUEUE, mediaTranscodeJobSchema } from "@yourtal/contracts/studio/media";
import type { MediaReadyCallbackRequest } from "@yourtal/contracts/studio/media";
import {
  createMediaClient,
  getRawObject,
  hlsAssetObjectKey,
  posterObjectKey,
  putMediaOutput,
  teaserObjectKey,
} from "@yourtal/media/studio-media";
import { defineJob } from "../job";
import { loadTranscodeConfig } from "./transcode-config";
import {
  probeInput,
  renderHlsLadder,
  renderPoster,
  renderTeaser,
} from "@yourtal/media/ffmpeg-transcode";
import { callReady } from "./transcode-ready-client";

/**
 * 7.2.b: HLS at 360p/540p/720p (6 s segments), a poster, a teaser, and an
 * optional caption track. Runs ffmpeg against the raw upload the object store holds
 * (`getRawObject`), uploads every rendition, and reports the result to
 * C's internal `/ready` endpoint — this job never touches `campaign.*`
 * tables itself (TASKS.md is explicit that the studio module does).
 *
 * A failure is reported through the SAME callback, `status: "failed"`, and
 * the job then returns normally rather than throwing: the api has already
 * recorded the terminal state (visible in Studio, 7.2.b's own requirement),
 * so pg-boss retrying a transcode that failed on the input itself would
 * just fail again. Only a failure to REACH the callback rethrows, so
 * pg-boss retries the whole job and the asset does not get stuck silently
 * "processing" forever.
 */
export const job = defineJob({
  queue: MEDIA_TRANSCODE_QUEUE,
  async handle(pgBossJob) {
    const data = mediaTranscodeJobSchema.parse(pgBossJob.data);
    const config = loadTranscodeConfig();
    const workDir = path.join(tmpdir(), `yt-media-${data.assetId}`);
    mkdirSync(workDir, { recursive: true });

    try {
      const result = await transcode(data, workDir);
      await callReady(config, data.assetId, result);
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : String(error);
      // If even reporting the failure throws, let the job fail loudly and retry.
      await callReady(config, data.assetId, { status: "failed", failureReason });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  },
});

async function transcode(
  data: { assetId: string; rawObjectKey: string; teaserStartSeconds: number },
  workDir: string,
): Promise<MediaReadyCallbackRequest> {
  const extension = data.rawObjectKey.split(".").pop() ?? "mp4";
  const inputPath = path.join(workDir, `source.${extension}`);
  const client = createMediaClient();
  const bytes = await getRawObject(client, data.rawObjectKey);
  writeFileSync(inputPath, bytes);

  const probe = await probeInput(inputPath);

  const hlsDir = path.join(workDir, "hls");
  mkdirSync(hlsDir, { recursive: true });
  const renditionBytes = await renderHlsLadder(inputPath, hlsDir);

  const posterPath = path.join(workDir, "poster.jpg");
  await renderPoster(inputPath, posterPath, Math.min(1, Math.floor(probe.durationSeconds / 10)));

  const teaserPath = path.join(workDir, "teaser.mp4");
  await renderTeaser({
    inputPath,
    outputPath: teaserPath,
    startSeconds: Math.min(data.teaserStartSeconds, Math.max(0, probe.durationSeconds - 15)),
    aspect: probe.aspect,
  });

  // Uploads: HLS ladder (master + every rendition file), then poster/teaser.
  await uploadHlsTree(client, data.assetId, hlsDir);
  await putMediaOutput(client, {
    kind: "poster",
    key: posterObjectKey(data.assetId),
    body: readFileSync(posterPath),
  });
  await putMediaOutput(client, {
    kind: "teaser",
    key: teaserObjectKey(data.assetId),
    body: readFileSync(teaserPath),
  });
  client.destroy();

  return {
    status: "ready",
    durationSeconds: probe.durationSeconds,
    aspect: probe.aspect,
    posterUrl: `/media/posters/${data.assetId}.jpg`,
    teaserUrl: `/media/teasers/${data.assetId}.mp4`,
    hlsUrl: `/media/hls/${data.assetId}/index.m3u8`,
    // No caption track for a plain uploaded video (7.2.b: "optional"); the
    // demo media kit (7.2.d) burns in facts and provides its own VTT
    // through a different path.
    captionsUrl: null,
    renditionBytes,
  };
}

function filesUnder(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(path.join(dir, entry.name), rel) : [rel];
  });
}

async function uploadHlsTree(
  client: ReturnType<typeof createMediaClient>,
  assetId: string,
  hlsDir: string,
): Promise<void> {
  for (const file of filesUnder(hlsDir)) {
    const body = readFileSync(path.join(hlsDir, ...file.split("/")));
    await putMediaOutput(client, { kind: "hls", key: hlsAssetObjectKey(assetId, file), body });
  }
}
