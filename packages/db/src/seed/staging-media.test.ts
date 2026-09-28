import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureStagingMedia } from "./staging-media";

// The local compose RustFS (and CI's, on the same port) with its local-only
// root credentials; a throwaway bucket so the dev `yourtal-media` is untouched.
const endpoint = process.env.S3_ENDPOINT ?? "http://127.0.0.1:26900";
const accessKeyId = process.env.S3_ACCESS_KEY ?? "yourtal";
const secretAccessKey = process.env.S3_SECRET_KEY ?? "yourtal_local_only";
const bucket = `yourtal-staging-media-test-${String(Date.now())}`;
const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../media/fixtures/attention-30s",
);

const client = new S3Client({
  endpoint,
  region: "us-east-1",
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

beforeAll(async () => {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
});

afterAll(async () => {
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
  const keys = (listed.Contents ?? []).flatMap((o) =>
    o.Key === undefined ? [] : [{ Key: o.Key }],
  );
  if (keys.length > 0) {
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
  }
  await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  client.destroy();
});

describe("ensureStagingMedia (2.3.i)", () => {
  const config = {
    fixtureDir,
    assetId: "attention-30s",
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
  };

  it("publishes every fixture file under hls/<asset>/, then uploads nothing on a rerun", async () => {
    const first = await ensureStagingMedia({ ...config, log: () => undefined });
    expect(first.status).toBe("published");
    expect(first.uploaded).toBe(first.total);
    expect(first.total).toBeGreaterThan(3);

    const manifest = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: "hls/attention-30s/index.m3u8" }),
    );
    expect(manifest.ContentType).toBe("application/vnd.apple.mpegurl");

    const second = await ensureStagingMedia({ ...config, log: () => undefined });
    expect(second).toEqual({ status: "already_present", uploaded: 0, total: first.total });
  });

  it("reports a failure instead of throwing when the bucket is wrong", async () => {
    const result = await ensureStagingMedia({
      ...config,
      bucket: `${bucket}-missing`,
      log: () => undefined,
    });
    expect(result.status).toBe("failed");
    expect(result.detail).toBeDefined();
  });
});
