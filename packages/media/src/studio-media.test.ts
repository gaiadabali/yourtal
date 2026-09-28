import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  abortRawUpload,
  completeRawUpload,
  createMediaClient,
  createRawUpload,
  getRawObject,
  posterObjectKey,
  putMediaOutput,
  rawObjectKey,
} from "./studio-media";

/**
 * Against the real local RustFS (YT-0521's convention: `hls-fixture.test.ts`
 * and `delivery-log.test.ts` already do the same). Not mocked: the point of
 * self-hosting is that the multipart-upload and presigned-URL code paths are
 * exercised against the actual S3 API this pipeline runs against in
 * production, not a client library's idea of what RustFS does.
 */
describe("studio media object store", () => {
  const client = createMediaClient();
  const cleanupKeys: string[] = [];

  afterAll(() => {
    client.destroy();
  });

  it("round-trips a raw multipart upload through RustFS", async () => {
    const assetId = randomUUID();
    const body = Buffer.from("x".repeat(6 * 1024 * 1024)); // one part, under the S3 multipart 5 MiB floor+
    const created = await createRawUpload(client, {
      assetId,
      extension: "mp4",
      contentType: "video/mp4",
      partCount: 1,
    });
    expect(created.key).toBe(rawObjectKey(assetId, "mp4"));
    cleanupKeys.push(created.key);

    const putResponse = await fetch(created.parts[0]?.url ?? "", { method: "PUT", body });
    expect(putResponse.ok).toBe(true);
    const eTag = putResponse.headers.get("etag");
    expect(eTag).not.toBeNull();

    await completeRawUpload(client, {
      key: created.key,
      uploadId: created.uploadId,
      parts: [{ partNumber: 1, eTag: eTag ?? "" }],
    });

    const downloaded = await getRawObject(client, created.key);
    expect(Buffer.from(downloaded).equals(body)).toBe(true);
  });

  it("aborting an upload leaves no completed object", async () => {
    const assetId = randomUUID();
    const created = await createRawUpload(client, {
      assetId,
      extension: "mp4",
      contentType: "video/mp4",
      partCount: 1,
    });
    await abortRawUpload(client, { key: created.key, uploadId: created.uploadId });
    await expect(getRawObject(client, created.key)).rejects.toThrow();
  });

  it("uploads a rendition to its public prefix", async () => {
    const assetId = randomUUID();
    const key = posterObjectKey(assetId);
    cleanupKeys.push(key);
    await putMediaOutput(client, { kind: "poster", key, body: Buffer.from("fake-jpeg-bytes") });
    const downloaded = await getRawObject(client, key);
    expect(Buffer.from(downloaded).toString()).toBe("fake-jpeg-bytes");
  });
});
