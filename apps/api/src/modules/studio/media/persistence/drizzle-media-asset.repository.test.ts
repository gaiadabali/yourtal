import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleMediaAssetRepository } from "./drizzle-media-asset.repository";
import {
  clearMediaAssets,
  createFixtureBusinessAndCampaign,
  testStudioMediaDb,
} from "./media-asset-db.test-helper";
import type { StudioMediaDb } from "./drizzle-client";

describe("DrizzleMediaAssetRepository", () => {
  let db: StudioMediaDb;
  let businessId: string;
  let campaignId: string;
  let cleanupTenant: () => Promise<void>;
  const createdIds: string[] = [];

  beforeAll(async () => {
    db = testStudioMediaDb();
    const databaseUrl = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"] ?? "";
    const fixture = await createFixtureBusinessAndCampaign(databaseUrl);
    businessId = fixture.businessId;
    campaignId = fixture.campaignId;
    cleanupTenant = fixture.cleanup;
  });

  afterAll(async () => {
    await clearMediaAssets(db, createdIds);
    await cleanupTenant();
  });

  it("creates an asset in 'uploading', then queues, ready-s and reads it back", async () => {
    const repo = new DrizzleMediaAssetRepository(db);
    const created = await repo.create({
      id: randomUUID(),
      businessId,
      campaignId,
      contentType: "video/mp4",
      sizeBytes: 12_345,
      rawObjectKey: `raw/${randomToken()}/source.mp4`,
      uploadId: "upload-1",
      teaserStartSeconds: 2,
    });
    createdIds.push(created.id);
    expect(created.status).toBe("uploading");
    expect(created.businessId).toBe(businessId);
    expect(created.campaignId).toBe(campaignId);

    await repo.markQueued(created.id);
    const queued = await repo.findById(created.id);
    expect(queued?.status).toBe("queued");

    const ready = await repo.markReady(created.id, {
      durationSeconds: 30,
      aspect: "16:9",
      posterUrl: `/media/posters/${created.id}.jpg`,
      teaserUrl: `/media/teasers/${created.id}.mp4`,
      hlsUrl: `/media/hls/${created.id}/index.m3u8`,
      captionsUrl: null,
      renditionBytes: { v360: 1_000, v540: 2_000, v720: 3_000 },
    });
    expect(ready.status).toBe("ready");
    expect(ready.renditionBytes).toEqual({ v360: 1_000, v540: 2_000, v720: 3_000 });

    const scoped = await repo.findByIdForBusiness(created.id, businessId);
    expect(scoped?.id).toBe(created.id);
    const wrongTenant = await repo.findByIdForBusiness(
      created.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(wrongTenant).toBeNull();
  });

  it("marks an asset failed with a reason", async () => {
    const repo = new DrizzleMediaAssetRepository(db);
    const created = await repo.create({
      id: randomUUID(),
      businessId,
      campaignId,
      contentType: "video/mp4",
      sizeBytes: 999,
      rawObjectKey: `raw/${randomToken()}/source.mp4`,
      uploadId: "upload-2",
      teaserStartSeconds: 0,
    });
    createdIds.push(created.id);

    const failed = await repo.markFailed(created.id, "ffprobe: no video stream");
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("ffprobe: no video stream");
  });
});

// A tiny unique-ish token for the raw key text; the key's realism doesn't
// matter here, only that two fixture rows in the same test never collide.
function randomToken(): string {
  return Math.random().toString(36).slice(2);
}
