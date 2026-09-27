import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "pg-boss";
import type { MediaReadyCallbackRequest, MediaTranscodeJob } from "@yourtal/contracts/studio/media";
import { verifyMediaServiceRequest } from "@yourtal/contracts/studio/media-service-signature";
import {
  completeRawUpload,
  createMediaClient,
  createRawUpload,
  getRawObject,
  hlsAssetObjectKey,
} from "@yourtal/media/studio-media";
import { job } from "./transcode";

/**
 * 7.2.b, against real ffmpeg and a real MinIO — a short generated clip (not
 * committed; built fresh in a temp dir, same convention
 * `packages/media/scripts/generate-fixture.mjs` uses for its own fixture),
 * transcoded for real, uploaded for real, and reported through a fake HTTP
 * server standing in for `apps/api`'s `/ready` endpoint. The signature and
 * DB-write halves of that endpoint are proven for real, against a live app,
 * by `apps/api/src/modules/studio/media/media.e2e.test.ts` — this file's
 * job is the ffmpeg/storage half that test cannot exercise.
 */

const SECRET = "test-only-media-service-secret-for-transcode-32b";

class FakeApi {
  received: MediaReadyCallbackRequest | undefined;
  badSignatures = 0;
  server: Server = createServer((req, res) => {
    void this.answer(req).then(([status, body]) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });

  private async answer(req: IncomingMessage): Promise<[number, unknown]> {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const verdict = verifyMediaServiceRequest({
      secret: SECRET,
      method: req.method ?? "",
      pathAndQuery: req.url ?? "",
      body: raw,
      header: req.headers["x-yourtal-media-signature"] as string | undefined,
    });
    if (!verdict.ok) {
      this.badSignatures++;
      return [403, { code: "forbidden" }];
    }
    this.received = JSON.parse(raw) as MediaReadyCallbackRequest;
    return [200, { ok: true }];
  }
}

let api: FakeApi;
let apiBaseUrl: string;
let workDir: string;

beforeAll(async () => {
  api = new FakeApi();
  await new Promise<void>((resolve) => api.server.listen(0, "127.0.0.1", resolve));
  apiBaseUrl = `http://127.0.0.1:${String((api.server.address() as AddressInfo).port)}`;
  process.env["STUDIO_MEDIA_SERVICE_SECRET"] = SECRET;
  process.env["STUDIO_MEDIA_API_BASE_URL"] = apiBaseUrl;

  workDir = mkdtempSync(path.join(tmpdir(), "yt-transcode-fixture-"));
});

afterAll(async () => {
  await new Promise((resolve) => api.server.close(resolve));
  rmSync(workDir, { recursive: true, force: true });
});

/** A short, real, 16:9 H.264 clip — generated, never committed. */
function generateClip(): string {
  const clipPath = path.join(workDir, `${randomUUID()}.mp4`);
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=30:duration=3",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100:duration=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    clipPath,
  ]);
  return clipPath;
}

/** The real presigned-multipart-upload path (7.2.a), driving it directly rather than over HTTP. */
async function uploadRaw(assetId: string, filePath: string): Promise<string> {
  const client = createMediaClient();
  const created = await createRawUpload(client, {
    assetId,
    extension: "mp4",
    contentType: "video/mp4",
    partCount: 1,
  });
  const put = await fetch(created.parts[0]?.url ?? "", {
    method: "PUT",
    body: readFileSync(filePath),
  });
  const eTag = put.headers.get("etag") ?? "";
  await completeRawUpload(client, {
    key: created.key,
    uploadId: created.uploadId,
    parts: [{ partNumber: 1, eTag }],
  });
  client.destroy();
  return created.key;
}

function fakeJob(data: MediaTranscodeJob): Job<MediaTranscodeJob> {
  return {
    id: data.assetId,
    name: "studio.media_transcode",
    data,
    // The handler reads only `.data` — the rest of pg-boss's `Job` shape is
    // irrelevant here, same convention `points-unlocked-notify.test.ts` uses.
  } as Job<MediaTranscodeJob>;
}

describe("transcode job", () => {
  it("downloads the raw upload, runs real ffmpeg, uploads every rendition, and reports ready", async () => {
    const assetId = randomUUID();
    const clipPath = generateClip();
    const rawKey = await uploadRaw(assetId, clipPath);

    await job.handle(fakeJob({ assetId, rawObjectKey: rawKey, teaserStartSeconds: 0 }), {
      boss: undefined as never,
      config: undefined as never,
    });

    expect(api.received?.status).toBe("ready");
    const ready = api.received;
    if (ready?.status !== "ready") throw new Error("expected a ready callback");
    expect(ready.durationSeconds).toBeGreaterThan(0);
    expect(ready.aspect).toBe("16:9");
    expect(ready.renditionBytes.v360).toBeGreaterThan(0);
    expect(ready.renditionBytes.v540).toBeGreaterThan(0);
    expect(ready.renditionBytes.v720).toBeGreaterThan(0);

    // The master playlist really exists in MinIO, at the exact key nginx's
    // /media/hls/ route resolves to (2.1.c, hls-origin.ts's HLS_PREFIX).
    const client = createMediaClient();
    const manifest = await getRawObject(client, hlsAssetObjectKey(assetId, "index.m3u8"));
    expect(Buffer.from(manifest).toString()).toContain("#EXTM3U");
    const segment = await getRawObject(client, hlsAssetObjectKey(assetId, "v1/segment0.ts"));
    expect(segment.length).toBeGreaterThan(0);
    client.destroy();
  }, 60_000);

  it("reports a failure when the input has no video stream", async () => {
    const assetId = randomUUID();
    const audioOnly = path.join(workDir, `${randomUUID()}.mp4`);
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100:duration=1",
      "-c:a",
      "aac",
      audioOnly,
    ]);
    const rawKey = await uploadRaw(assetId, audioOnly);

    await job.handle(fakeJob({ assetId, rawObjectKey: rawKey, teaserStartSeconds: 0 }), {
      boss: undefined as never,
      config: undefined as never,
    });

    expect(api.received?.status).toBe("failed");
  }, 30_000);
});
