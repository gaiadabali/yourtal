import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * TASKS.md 7.1.b's presigned-upload seam for KYB documents, living here
 * rather than in `apps/api` because this package IS the object-storage
 * adapter (`eslint-rules/no-vendor-sdk.mjs`'s own `ADAPTER_DIRECTORIES`
 * comment: "packages/media is the object-storage adapter, which uses the S3
 * client deliberately so the R2 path is exercised rather than stubbed").
 * `hls-origin.ts` reads and serves; this mints presigned writes and checks
 * existence — a different half of the same one bucket
 * (`S3_BUCKET`/`MEDIA_BUCKET`), never a second one.
 *
 * Structurally typed on purpose: `apps/api`'s own `KybObjectStorage`
 * interface (`apps/api/src/modules/business/object-storage/kyb-object-
 * storage.ts`) is not imported here — this package has no business
 * depending on a domain module's port, and TypeScript's structural typing
 * makes that unnecessary. `createKybObjectStorage`'s return shape simply
 * happens to match it.
 */

export interface KybObjectStorageConfig {
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  /** Where a browser PUTs (13.3.b): `MEDIA_PRESIGN_ENDPOINT` on staging, where `endpoint` is loopback-only. */
  readonly presignEndpoint?: string;
}

export interface KybUploadUrl {
  readonly storageRef: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

/** How long the presigned PUT stays valid — long enough for a slow mobile upload, short enough not to linger. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/** `kyb/<businessId>/<uuid>` — `HLS_PREFIX` in `hls-origin.ts` keeps this bucket's other tenant apart. */
const KYB_PREFIX = "kyb";

/**
 * Reads `S3_BUCKET` and friends the same way `hls-origin.ts`'s
 * `resolveOriginEndpoint`/`resolveCredentials` do (env, falling back to the
 * repo's `.env` for a bare script or test run) — a small, deliberate
 * duplication rather than exporting their private helper, since this is the
 * one other file in the package that needs it and `S3_BUCKET` differs from
 * their own hardcoded `MEDIA_BUCKET` constant (this reads the real one,
 * because a KYB upload and the HLS origin share the SAME bucket, just
 * different prefixes).
 */
export function resolveKybObjectStorageConfig(): KybObjectStorageConfig {
  return {
    endpoint: readEnv("S3_ENDPOINT") ?? "http://127.0.0.1:26900",
    accessKeyId: readEnv("S3_ACCESS_KEY") ?? "yourtal",
    secretAccessKey: readEnv("S3_SECRET_KEY") ?? "yourtal_local_only",
    bucket: readEnv("S3_BUCKET") ?? "yourtal-media",
  };
}

function readEnv(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== "") return fromProcess;

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const envFile = path.join(repoRoot, ".env");
  if (!existsSync(envFile)) return undefined;

  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`).exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

export function createKybObjectStorage(config: KybObjectStorageConfig) {
  const s3 = (endpoint: string) =>
    new S3Client({
      endpoint,
      region: "auto",
      // RustFS needs path-style addressing
      // (`endpoint/bucket/key`), not the virtual-hosted style AWS itself
      // defaults to (`bucket.endpoint/key`) — same reasoning `hls-origin.ts`'s
      // own client construction documents.
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // F58: this mints presigned PUT URLs (`getSignedUrl` below) — same
      // SDK-v3-vs-RustFS checksum incompatibility `studio-media.ts`'s
      // `createMediaClient()` documents. Without this, RustFS answers a real
      // upload's PUT with `400 BadDigest` against a placeholder checksum baked
      // into the URL before the real bytes existed.
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  const client = s3(config.endpoint);
  const presignClient = s3(
    config.presignEndpoint ?? readEnv("MEDIA_PRESIGN_ENDPOINT") ?? config.endpoint,
  );
  const bucket = config.bucket;
  /** Checked once per process, not once per request — `ensureBucket` is a HeadBucket round trip. */
  let bucketReady: Promise<void> | undefined;

  async function ensureBucket(): Promise<void> {
    bucketReady ??= (async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return;
      } catch {
        // Absent, or not readable by these credentials — creating tells us which.
      }
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    })();
    return bucketReady;
  }

  return {
    async createUploadUrl(input: {
      readonly businessId: string;
      readonly contentType: string;
    }): Promise<KybUploadUrl> {
      await ensureBucket();
      const storageRef = `${KYB_PREFIX}/${input.businessId}/${randomUUID()}`;
      const uploadUrl = await getSignedUrl(
        presignClient,
        new PutObjectCommand({ Bucket: bucket, Key: storageRef, ContentType: input.contentType }),
        // The declared type is signed, so the PUT must carry it.
        { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(["content-type"]) },
      );
      return {
        storageRef,
        uploadUrl,
        expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      };
    },

    async exists(storageRef: string): Promise<boolean> {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: storageRef }));
        return true;
      } catch {
        // Any failure (404, network, credentials) reads as "not there yet" —
        // the caller's own retry (re-request an upload URL, upload again)
        // is the correct recovery for every one of those causes here.
        return false;
      }
    },
  };
}
