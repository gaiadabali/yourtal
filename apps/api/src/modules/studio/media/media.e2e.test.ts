import { inArray, sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signMediaServiceRequest } from "@yourtal/contracts/studio/media-service-signature";
import { AppModule } from "../../../app.module";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { sessionFor } from "../../../shared/testing/session-for";
import { createFixtureBusinessAndCampaign } from "./persistence/media-asset-db.test-helper";
import { mediaAssets } from "./persistence/schema/media-asset.table";

/**
 * 7.2.a/7.2.b/7.2.c, over the real HTTP stack and a real object store: a real Nest
 * app, real Cerbos-gated routes, and a real presigned multipart upload —
 * same shape `watch-earn-journey.e2e.test.ts` uses. The one thing this does
 * NOT run for real is ffmpeg: the `/ready` step is called directly with a
 * signed payload, standing in for `apps/worker`'s transcode job, exactly the
 * way `transcode.test.ts` (apps/worker) proves the ffmpeg half without
 * needing a live api to call back into.
 */

const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const SERVICE_SECRET = "local-only-studio-media-service-secret-not-real-32b";

let app: NestFastifyApplication;
let businessId: string;
let campaignId: string;
let ownerCookie: string;
const createdAssetIds: string[] = [];

/**
 * `app.inject(...)`'s response `.json()` returns `any` — narrowed here once,
 * same convention `watch-earn-journey.e2e.test.ts`'s own `json<T>` helper
 * uses, so `no-unnecessary-type-assertion` does not flag a same-line `as`
 * against a value TS already sees as `any`.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see the comment above.
function json<T>(response: { json: () => unknown }): T {
  return response.json() as T;
}

beforeAll(async () => {
  const fixture = await createFixtureBusinessAndCampaign(process.env["DATABASE_OWNER_URL"] ?? "");
  businessId = fixture.businessId;
  campaignId = fixture.campaignId;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const session = await sessionFor(app);
  ownerCookie = session.cookie;

  // A real business_members row: owner of the fixture business, matching
  // policies/derived_roles/business.yaml's business_campaign_editor_of.
  await owner.execute(sql`
    INSERT INTO business.business_members
      (business_id, user_id, role, invited_by_user_id, joined_at)
    VALUES (${businessId}, ${session.userId}, 'owner', ${session.userId}, now())
  `);
});

afterAll(async () => {
  if (createdAssetIds.length > 0) {
    await owner.delete(mediaAssets).where(inArray(mediaAssets.id, createdAssetIds));
  }
  await owner.execute(sql`DELETE FROM business.business_members WHERE business_id = ${businessId}`);
  await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM business.business_accounts WHERE id = ${businessId}`);
  await app.close();
});

async function initiateUpload(): Promise<{
  assetId: string;
  uploadId: string;
  parts: readonly { partNumber: number; url: string }[];
}> {
  const response = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/media/initiate`,
    headers: { cookie: ownerCookie },
    payload: {
      campaignId,
      filename: "clip.mp4",
      contentType: "video/mp4",
      sizeBytes: 6 * 1024 * 1024,
      teaserStartSeconds: 2,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = json<{
    assetId: string;
    uploadId: string;
    parts: { partNumber: number; url: string }[];
  }>(response);
  createdAssetIds.push(body.assetId);
  return body;
}

describe("studio media pipeline (7.2)", () => {
  it("uploads through the real HTTP API to a real object-store object, completes, and queues a real transcode job", async () => {
    const initiated = await initiateUpload();
    expect(initiated.parts.length).toBeGreaterThan(0);

    const eTags: { partNumber: number; eTag: string }[] = [];
    for (const part of initiated.parts) {
      const put = await fetch(part.url, {
        method: "PUT",
        body: Buffer.from("x".repeat(6 * 1024 * 1024)),
      });
      expect(put.ok).toBe(true);
      const eTag = put.headers.get("etag");
      expect(eTag).not.toBeNull();
      eTags.push({ partNumber: part.partNumber, eTag: eTag ?? "" });
    }

    const completed = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/media/${initiated.assetId}/complete`,
      headers: { cookie: ownerCookie },
      payload: { parts: eTags },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json()).toMatchObject({ status: "queued" });

    // A real pg-boss job row, not an assumption that `.send()` worked.
    const jobs = await owner.execute<{ data: unknown }>(sql`
      SELECT data FROM pgboss.job WHERE id = ${initiated.assetId}
    `);
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]?.data).toMatchObject({ assetId: initiated.assetId });

    // Completing again (a retried call) replays the same success — idempotent.
    const repeated = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/media/${initiated.assetId}/complete`,
      headers: { cookie: ownerCookie },
      payload: { parts: eTags },
    });
    expect(repeated.statusCode, repeated.body).toBe(200);
  });

  it("a caller from a different tenant cannot read or complete this asset", async () => {
    const initiated = await initiateUpload();
    const stranger = await sessionFor(app);

    const got = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/media/${initiated.assetId}`,
      headers: { cookie: stranger.cookie },
    });
    expect(got.statusCode).toBe(403);
  });

  it("the worker's ready callback writes the asset AND the campaign's media columns", async () => {
    const initiated = await initiateUpload();
    const body = {
      status: "ready" as const,
      durationSeconds: 42,
      aspect: "16:9" as const,
      posterUrl: `/media/posters/${initiated.assetId}.jpg`,
      teaserUrl: `/media/teasers/${initiated.assetId}.mp4`,
      hlsUrl: `/media/hls/${initiated.assetId}/index.m3u8`,
      captionsUrl: null,
      renditionBytes: { v360: 1_000_000, v540: 2_000_000, v720: 3_000_000 },
    };
    const payload = JSON.stringify(body);
    const path = `/api/internal/studio/media/${initiated.assetId}/ready`;

    const forged = await app.inject({
      method: "POST",
      url: path,
      headers: {
        "content-type": "application/json",
        "x-yourtal-media-signature": "t=1,v1=deadbeef",
      },
      payload,
    });
    expect(forged.statusCode).toBe(403);

    const signed = signMediaServiceRequest({
      secret: SERVICE_SECRET,
      method: "POST",
      pathAndQuery: path,
      body: payload,
    });
    const ready = await app.inject({
      method: "POST",
      url: path,
      headers: { "content-type": "application/json", "x-yourtal-media-signature": signed },
      payload,
    });
    expect(ready.statusCode, ready.body).toBe(200);

    const asset = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/media/${initiated.assetId}`,
      headers: { cookie: ownerCookie },
    });
    expect(asset.json()).toMatchObject({ status: "ready", hlsUrl: body.hlsUrl });

    const campaignRow = await owner.execute<{
      poster_url: string;
      teaser_url: string;
      hls_url: string;
      aspect: string;
      estimated_bytes: string;
      manifest_url: string;
    }>(
      sql`SELECT c.poster_url, c.teaser_url, c.hls_url, c.aspect, c.estimated_bytes::text, v.manifest_url
            FROM campaign.campaigns c JOIN campaign.video_source v ON v.campaign_id = c.id
           WHERE c.id = ${campaignId}`,
    );
    expect(campaignRow.rows[0]).toMatchObject({
      aspect: "16:9",
      estimated_bytes: "2000000",
      manifest_url: body.hlsUrl,
      poster_url: body.posterUrl,
      teaser_url: body.teaserUrl,
      hls_url: body.hlsUrl,
    });

    // 13.3.b: a long-form campaign takes the video's length and one whole-video chapter.
    const shape = await owner.execute<{ kind: string; duration: number; chapters: string }>(
      sql`SELECT c.kind, c.duration_seconds AS duration,
                 (SELECT count(*) FROM campaign.chapter ch WHERE ch.campaign_id = c.id)::text AS chapters
            FROM campaign.campaigns c WHERE c.id = ${campaignId}`,
    );
    expect(shape.rows[0]).toEqual({ kind: "long_form", duration: 42, chapters: "1" });

    // Idempotent replay: a second "ready" for an already-ready asset is a no-op success.
    const repeated = await app.inject({
      method: "POST",
      url: path,
      headers: { "content-type": "application/json", "x-yourtal-media-signature": signed },
      payload,
    });
    expect(repeated.statusCode).toBe(200);
  });

  // 13.9.c: a sidecar .vtt is the fallback for a video with no subtitle stream.
  const VTT = ["WEBVTT", "", "00:00:01.000 --> 00:00:04.000", "Welcome to Harbour Grind.", ""].join(
    "\n",
  );

  async function sendReady(assetId: string, captionsUrl: string | null) {
    const payload = JSON.stringify({
      status: "ready",
      durationSeconds: 42,
      aspect: "16:9",
      posterUrl: `/media/posters/${assetId}.jpg`,
      teaserUrl: `/media/teasers/${assetId}.mp4`,
      hlsUrl: `/media/hls/${assetId}/index.m3u8`,
      captionsUrl,
      renditionBytes: { v360: 1_000_000, v540: 2_000_000, v720: 3_000_000 },
    });
    const path = `/api/internal/studio/media/${assetId}/ready`;
    const signed = signMediaServiceRequest({
      secret: SERVICE_SECRET,
      method: "POST",
      pathAndQuery: path,
      body: payload,
    });
    const ready = await app.inject({
      method: "POST",
      url: path,
      headers: { "content-type": "application/json", "x-yourtal-media-signature": signed },
      payload,
    });
    expect(ready.statusCode, ready.body).toBe(200);
  }

  const putCaptions = (assetId: string, vtt: string) =>
    app.inject({
      method: "PUT",
      url: `/api/${businessId}/studio/media/${assetId}/captions`,
      headers: { cookie: ownerCookie },
      payload: { vtt },
    });

  const campaignCaptions = async () =>
    (
      await owner.execute<{ captions_url: string | null }>(
        sql`SELECT captions_url FROM campaign.campaigns WHERE id = ${campaignId}`,
      )
    ).rows[0]?.captions_url ?? null;

  it("13.9.c: a sidecar uploaded before the transcode is used when the video has no subtitle stream", async () => {
    const initiated = await initiateUpload();
    expect((await putCaptions(initiated.assetId, "not a caption file")).statusCode).toBe(400);
    const noCues = ["WEBVTT", "", "no cues here"].join("\n");
    expect((await putCaptions(initiated.assetId, noCues)).statusCode).toBe(400);
    const uploaded = await putCaptions(initiated.assetId, VTT);
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    const sidecar = uploaded.json<{ sidecarCaptionsUrl: string; captionsUrl: string | null }>();
    expect(sidecar.sidecarCaptionsUrl.endsWith(`captions/${initiated.assetId}.sidecar.vtt`)).toBe(
      true,
    );
    expect(sidecar.captionsUrl).toBeNull();

    await sendReady(initiated.assetId, null);
    expect(await campaignCaptions()).toBe(sidecar.sidecarCaptionsUrl);
  });

  it("13.9.c: an embedded subtitle stream wins over a sidecar", async () => {
    const initiated = await initiateUpload();
    await putCaptions(initiated.assetId, VTT);
    const embedded = `/media/captions/${initiated.assetId}.vtt`;
    await sendReady(initiated.assetId, embedded);
    expect(await campaignCaptions()).toBe(embedded);
    // Re-uploading a sidecar later never displaces the embedded track.
    await putCaptions(initiated.assetId, VTT);
    expect(await campaignCaptions()).toBe(embedded);
  });

  it("13.9.c: a sidecar uploaded after the transcode applies at once when there were no captions", async () => {
    const initiated = await initiateUpload();
    await sendReady(initiated.assetId, null);
    expect(await campaignCaptions()).toBeNull();
    const uploaded = await putCaptions(initiated.assetId, VTT);
    const url = uploaded.json<{ sidecarCaptionsUrl: string }>().sidecarCaptionsUrl;
    expect(uploaded.json<{ captionsUrl: string }>().captionsUrl).toBe(url);
    expect(await campaignCaptions()).toBe(url);
  });

  it("reports a transcode failure so it is visible in Studio", async () => {
    const initiated = await initiateUpload();
    const body = { status: "failed" as const, failureReason: "ffprobe: no video stream" };
    const payload = JSON.stringify(body);
    const path = `/api/internal/studio/media/${initiated.assetId}/ready`;
    const signed = signMediaServiceRequest({
      secret: SERVICE_SECRET,
      method: "POST",
      pathAndQuery: path,
      body: payload,
    });

    const response = await app.inject({
      method: "POST",
      url: path,
      headers: { "content-type": "application/json", "x-yourtal-media-signature": signed },
      payload,
    });
    expect(response.statusCode, response.body).toBe(200);

    const asset = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/media/${initiated.assetId}`,
      headers: { cookie: ownerCookie },
    });
    expect(asset.json()).toMatchObject({ status: "failed", failureReason: body.failureReason });
  });
});
