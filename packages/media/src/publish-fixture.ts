import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  CreateBucketCommand,
  GetBucketPolicyCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  FIXTURE_ASSET_ID,
  HLS_PREFIX,
  MEDIA_BUCKET,
  contentTypeFor,
  fixtureDir,
  manifestUrl,
  objectKey,
  resolveCredentials,
  resolveOriginEndpoint,
} from "./hls-origin";

/**
 * Publishes the HLS fixture to the local RustFS origin (F58; MinIO before
 * it). YT-0521.
 *
 *   pnpm --filter @yourtal/media publish
 *
 * ## Through the S3 API, not a CLI
 *
 * RustFS ships no CLI of its own (only its `rustfs` server binary; MinIO
 * before it shipped `mc`, and `docker exec … mc cp` would have been three
 * lines). The reason this uses `@aws-sdk/client-s3` instead is the one
 * `docker-compose.yml` gives for running a self-hosted S3 origin at all:
 * *S3-compatible, so the R2 adapter is exercised rather than stubbed.* A
 * publish path that goes through a CLI inside a container exercises nothing
 * that will exist in production. This code is the R2 upload path, pointed at
 * a different endpoint.
 *
 * `forcePathStyle` is required: RustFS serves `endpoint/bucket/key`, while
 * the SDK defaults to virtual-hosted `bucket.endpoint/key`, which does not
 * resolve against an IP address.
 *
 * ## Anonymous read on one prefix
 *
 * The bucket policy grants public `GetObject` under `hls/` and nothing else.
 * An origin serves a CDN, and a CDN presents no credentials — signing every
 * segment would be a different design (`docs/22` option A signs per *session*
 * to attribute fetches, which is the hardening step, not this one).
 *
 * Scoping to the prefix rather than the bucket matters because this bucket is
 * `S3_BUCKET` for the whole stack: KYB documents and receipt uploads will land
 * here too, and a bucket-wide public policy would publish them.
 */

/**
 * Every file of the asset, relative to its directory, walking the rendition
 * subdirectories (`v0/`, `v1/`, `v2/`). A flat `readdirSync` returned the
 * master playlist and three directory entries, so the ladder silently did
 * not publish and only the master was served — a 404 on the first level
 * switch, with nothing wrong at the top level to notice.
 */
function filesUnder(root: string, prefix = ""): string[] {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(root, relative) : [relative];
  });
}

export interface PublishResult {
  readonly bucket: string;
  readonly assetId: string;
  readonly uploaded: readonly string[];
  readonly manifestUrl: string;
}

export function createOriginClient(): S3Client {
  return new S3Client({
    endpoint: resolveOriginEndpoint(),
    region: "us-east-1", // MinIO ignores it; the SDK refuses to run without one.
    credentials: resolveCredentials(),
    forcePathStyle: true,
  });
}

async function ensureBucket(client: S3Client): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: MEDIA_BUCKET }));
    return;
  } catch {
    // Absent, or not readable by these credentials. Creating tells us which.
  }
  await client.send(new CreateBucketCommand({ Bucket: MEDIA_BUCKET }));
}

/**
 * F58: this ran with the app's own least-privilege key in staging (this
 * publishes through `ensureStagingMedia`, part of the pre-reload seed) —
 * on RustFS that key cannot set bucket policy at all (by design; see
 * `studio-media.ts`'s `ensureStudioMediaBucket`, same reasoning). Checks and
 * warns instead of setting it; provisioning (`infra/helios/bootstrap.sh` or
 * `docker-compose.yml`) already covers `hls/` in its own public-read grant.
 */
async function allowAnonymousReadOfHls(client: S3Client): Promise<void> {
  const resource = `arn:aws:s3:::${MEDIA_BUCKET}/${HLS_PREFIX}/*`;
  try {
    const { Policy } = await client.send(new GetBucketPolicyCommand({ Bucket: MEDIA_BUCKET }));
    const parsed: unknown = Policy ? JSON.parse(Policy) : null;
    const resources = new Set<string>(
      parsed && typeof parsed === "object" && "Statement" in parsed
        ? (parsed as { Statement: readonly { Resource?: readonly string[] | string }[] }).Statement.flatMap(
            (statement) =>
              Array.isArray(statement.Resource)
                ? statement.Resource
                : statement.Resource
                  ? [statement.Resource]
                  : [],
          )
        : [],
    );
    if (!resources.has(resource)) {
      console.warn(
        `[publish-fixture] bucket "${MEDIA_BUCKET}"'s policy does not grant public read on ${HLS_PREFIX}/*. ` +
          "This process's own credentials cannot set it (least-privilege, F58) — provisioning must.",
      );
    }
  } catch (error) {
    console.warn(
      `[publish-fixture] could not read bucket "${MEDIA_BUCKET}"'s policy to verify public read on ${HLS_PREFIX}/*: ${error instanceof Error ? error.message : String(error)}. ` +
        "Provisioning (infra/helios/bootstrap.sh or docker-compose.yml) must have set it; this process never will.",
    );
  }

  // A browser plays this fixture cross-origin in dev — same reasoning
  // `studio-media.ts`'s own `ensureStudioMediaBucket` documents: MinIO
  // answered a permissive CORS header by default with no config, RustFS
  // does not. Best-effort; this is dev/test-only, never staging traffic
  // that depends on it.
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: MEDIA_BUCKET,
        CORSConfiguration: {
          CORSRules: [
            { AllowedOrigins: ["*"], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"] },
          ],
        },
      }),
    );
  } catch (error) {
    console.warn(
      `[publish-fixture] could not set bucket "${MEDIA_BUCKET}"'s CORS config: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}

export async function publishFixture(assetId: string = FIXTURE_ASSET_ID): Promise<PublishResult> {
  const client = createOriginClient();
  await ensureBucket(client);
  await allowAnonymousReadOfHls(client);

  const directory = fixtureDir();
  const files = filesUnder(directory).sort();
  if (files.length === 0) {
    throw new Error(
      `No fixture files in ${directory}. Run \`node scripts/generate-fixture.mjs\` (needs ffmpeg).`,
    );
  }

  for (const file of files) {
    await client.send(
      new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: objectKey(assetId, file),
        Body: readFileSync(path.join(directory, file)),
        ContentType: contentTypeFor(file),
        // A manifest must never be cached the way a segment can be: for live
        // streams it is rewritten in place. This fixture is VOD, but the
        // header is a property of the file type, not of this asset.
        CacheControl: file.endsWith(".m3u8") ? "no-cache" : "public, max-age=31536000, immutable",
      }),
    );
  }

  client.destroy();
  return { bucket: MEDIA_BUCKET, assetId, uploaded: files, manifestUrl: manifestUrl(assetId) };
}

async function main(): Promise<void> {
  const result = await publishFixture();
  console.log(
    `Published ${String(result.uploaded.length)} files to ${result.bucket}/${HLS_PREFIX}/${result.assetId}\n` +
      `Manifest: ${result.manifestUrl}`,
  );
}

if (process.argv[1]?.endsWith("publish-fixture.ts") === true) {
  await main();
}
