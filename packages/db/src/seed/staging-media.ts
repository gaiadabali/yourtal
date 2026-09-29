import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * 2.3.i: staging's campaigns point at the 30 s HLS fixture
 * (`hls/attention-30s/…` in `yourtal-media`), so the seed publishes it there.
 *
 * Objects only. Unlike `packages/media`'s `publishFixture`, this never
 * rewrites the bucket policy: on Helios the same bucket also serves posters,
 * teasers and captions, and nginx alone decides what is public
 * (`infra/helios/nginx`). Idempotent: an object already present at the same
 * size is left alone, so a normal deploy uploads nothing.
 */
export interface StagingMediaConfig {
  /** The fixture directory shipped in the release (`media-fixtures/attention-30s`). */
  readonly fixtureDir: string;
  readonly assetId: string;
  readonly bucket: string;
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly log?: (message: string) => void;
}

export interface StagingMediaResult {
  readonly status: "published" | "already_present" | "failed";
  readonly uploaded: number;
  readonly total: number;
  readonly detail?: string;
}

function filesUnder(root: string, prefix = ""): string[] {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(root, relative) : [relative];
  });
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (file.endsWith(".ts")) return "video/mp2t";
  if (file.endsWith(".jpg")) return "image/jpeg";
  if (file.endsWith(".mp4")) return "video/mp4";
  throw new Error(`no media content type for ${file}`);
}

// A fixture's poster and teaser live under the public prefixes nginx serves; the rest is HLS.
function objectKeyFor(assetId: string, file: string): string | null {
  if (file === "poster.jpg") return `posters/${assetId}.jpg`;
  if (file === "teaser.mp4") return `teasers/${assetId}.mp4`;
  if (file.endsWith(".txt")) return null;
  return `hls/${assetId}/${file}`;
}

async function remoteSize(client: S3Client, bucket: string, key: string): Promise<number | null> {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? null;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

export async function ensureStagingMedia(config: StagingMediaConfig): Promise<StagingMediaResult> {
  const log = config.log ?? console.log;
  const files = filesUnder(config.fixtureDir).sort();
  if (files.length === 0) {
    return { status: "failed", uploaded: 0, total: 0, detail: `no files in ${config.fixtureDir}` };
  }

  const client = new S3Client({
    endpoint: config.endpoint,
    region: "us-east-1", // RustFS ignores it; the SDK refuses to run without one.
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
  });

  let uploaded = 0;
  try {
    for (const file of files) {
      const local = path.join(config.fixtureDir, file);
      const key = objectKeyFor(config.assetId, file);
      if (key === null) continue;
      if ((await remoteSize(client, config.bucket, key)) === statSync(local).size) continue;
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: readFileSync(local),
          ContentType: contentTypeFor(file),
        }),
      );
      uploaded += 1;
    }
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    log(`[seed:staging] media upload to ${config.bucket} failed: ${detail}`);
    return { status: "failed", uploaded, total: files.length, detail };
  } finally {
    client.destroy();
  }

  return {
    status: uploaded === 0 ? "already_present" : "published",
    uploaded,
    total: files.length,
  };
}
