import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  GetBucketPolicyCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  bucketPolicyResources,
  contentTypeFor as hlsContentTypeFor,
  HLS_PREFIX,
  objectKey as hlsObjectKey,
  isAccessDenied,
  resolveCredentials,
  resolveMediaBucket,
  resolveMediaCorsOrigins,
  resolveOriginEndpoint,
  resolvePresignEndpoint,
} from "./hls-origin";

/**
 * The studio media pipeline's object layout (TASKS.md 7.2), on the SAME
 * bucket `hls-origin.ts` already publishes the player fixture to. Every
 * prefix here matches `infra/helios/nginx/yourtal.gaiada.com.conf`
 * (2.1.c) exactly: `posters/`, `teasers/`, `captions/` are proxied public
 * and read-only, `hls/` is proxied behind the per-session signature, and
 * anything else under `/media/` 404s — which is why raw uploads live under
 * `raw/` and are never served through nginx at all, only read by the worker
 * directly off RustFS (loopback-only in production).
 */
export const RAW_PREFIX = "raw";
export const POSTER_PREFIX = "posters";
export const TEASER_PREFIX = "teasers";
export const CAPTIONS_PREFIX = "captions";

export function rawObjectKey(assetId: string, extension: string): string {
  return `${RAW_PREFIX}/${assetId}/source.${extension}`;
}
export function posterObjectKey(assetId: string): string {
  return `${POSTER_PREFIX}/${assetId}.jpg`;
}
export function teaserObjectKey(assetId: string): string {
  return `${TEASER_PREFIX}/${assetId}.mp4`;
}
export function captionsObjectKey(assetId: string): string {
  return `${CAPTIONS_PREFIX}/${assetId}.vtt`;
}
/** The HLS asset id nginx and `hls-token.ts` route on is the media asset id itself. */
export function hlsAssetObjectKey(assetId: string, file: string): string {
  return hlsObjectKey(assetId, file);
}

/**
 * `posters/`, `teasers/`, `captions/` and `hls/` are the exact prefixes
 * `infra/helios/nginx/yourtal.gaiada.com.conf` (2.1.c) proxies publicly, with
 * NO S3 credentials attached to that proxy — RustFS/R2 has to allow
 * anonymous `GetObject` on all four, or nginx serves a 403 for every asset
 * this pipeline produces. `publish-fixture.ts`'s own `allowAnonymousReadOfHls`
 * only ever covered `hls/`, because it predates uploaded (non-fixture)
 * media entirely; this is its studio-pipeline twin, covering the other
 * three prefixes nginx also serves.
 */
const PUBLIC_READ_PREFIXES = [HLS_PREFIX, POSTER_PREFIX, TEASER_PREFIX, CAPTIONS_PREFIX];

/** Memoised per bucket name: called on every upload, but the check itself only needs to happen once. */
const policyEnsured = new Set<string>();

/**
 * F58 (founder, 2026-09-28): on RustFS, the app's own key is
 * least-privilege — object CRUD + bucket-level list, no `PutBucketPolicy`
 * (confirmed empirically: the app key gets a clean `AccessDenied` on that
 * call, by design). The public-read policy for `hls/`, `posters/`,
 * `teasers/`, `captions/` is set exactly ONCE, by root, at provisioning time
 * (`infra/helios/bootstrap.sh`'s own curl+SigV4 recipe; `docker-compose.yml`
 * for local dev). This function used to set that policy itself with the
 * app's own credentials. RustFS's least-privilege split means that 403s
 * outright now — an app process is never the right actor to widen its own
 * bucket's public surface. It TRIES to check the policy already covers
 * what this pipeline needs, but the same least-privilege canned policy
 * grants no `s3:GetBucketPolicy`/`s3:PutBucketCORS` either (found live,
 * 2026-09-28 — see `isAccessDenied` below), so on a real deployment this
 * check itself 403s on every boot. Provisioning owns verifying its own
 * policy now (`infra/helios/bootstrap.sh`'s recipe checks what it just
 * set); this only still checks for local dev, where the app runs as root
 * and the check can actually succeed.
 */
async function ensureStudioMediaBucket(client: S3Client): Promise<void> {
  const bucket = resolveMediaBucket();
  if (policyEnsured.has(bucket)) return;

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }

  try {
    const { Policy } = await client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
    const resources = bucketPolicyResources(Policy);
    const missing = PUBLIC_READ_PREFIXES.filter(
      (prefix) => !resources.has(`arn:aws:s3:::${bucket}/${prefix}/*`),
    );
    if (missing.length > 0) {
      console.warn(
        `[studio-media] bucket "${bucket}"'s policy does not grant public read on: ${missing.join(", ")}. ` +
          "This app's own credentials cannot set it (least-privilege, F58) — provisioning must (infra/helios/bootstrap.sh or docker-compose.yml).",
      );
    }
  } catch (error) {
    if (isAccessDenied(error)) {
      console.info(
        `[studio-media] bucket "${bucket}"'s policy: provisioning's own job now (least-privilege key, F58) — skipping the check.`,
      );
    } else {
      console.warn(
        `[studio-media] could not read bucket "${bucket}"'s policy to verify public read on ${PUBLIC_READ_PREFIXES.join(", ")}: ${error instanceof Error ? error.message : String(error)}. ` +
          "Provisioning (infra/helios/bootstrap.sh or docker-compose.yml) must have set it; this app never will.",
      );
    }
  }

  // A real browser PUTs presigned upload parts straight from the studio UI's
  // origin to this bucket's origin — cross-origin, so it needs the bucket's
  // own CORS config, not the public-read policy above (a separate S3
  // feature, not gated by F58's "policy set once by root" rule — RustFS
  // answers no CORS header at all without an explicit rule). Best-effort:
  // this app's own least-privileged key may not carry
  // `s3:PutBucketCORS` either, and a missing CORS config only breaks direct
  // browser uploads, not this process — warn, don't crash.
  //
  // `*` is refused on purpose (founder, 2026-09-28): `resolveMediaCorsOrigins()`
  // names the real web origin(s), never a wildcard. `ETag` is exposed
  // because `completeRawUpload` below needs each part's ETag back from the
  // browser's own PUT response to complete the multipart upload.
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [...resolveMediaCorsOrigins()],
              AllowedMethods: ["GET", "HEAD", "PUT"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
            },
          ],
        },
      }),
    );
  } catch (error) {
    if (isAccessDenied(error)) {
      console.info(
        `[studio-media] bucket "${bucket}"'s CORS config: provisioning's own job now (least-privilege key, F58) — skipping the check.`,
      );
    } else {
      console.warn(
        `[studio-media] could not set bucket "${bucket}"'s CORS config (needed for direct browser uploads): ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }
  policyEnsured.add(bucket);
}

export function createMediaClient(): S3Client {
  return new S3Client({
    endpoint: resolveOriginEndpoint(),
    region: "us-east-1", // RustFS ignores it; the SDK refuses to run without one.
    credentials: resolveCredentials(),
    forcePathStyle: true,
    // F58: the SDK v3's default embeds a CRC32 checksum placeholder into a
    // presigned URL's query string, computed before the real bytes exist.
    // RustFS validates that checksum strictly (a well-known SDK-v3-vs-
    // non-AWS-S3 incompatibility other S3-compatible stores special-case
    // around; RustFS did not, as of its 1.0.0 GA) and rejects the real PUT with
    // `400 BadDigest`. Confirmed empirically: with this option, the
    // presigned URL carries no checksum param and the full
    // create-multipart -> presign -> PUT -> complete cycle succeeds.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

/**
 * A second client, presigning-only, for the ONE call a real browser has to
 * reach directly: the upload part PUT (found live on staging, 2026-09-28 —
 * `createMediaClient()`'s own endpoint is `S3_ENDPOINT`, loopback-only on
 * Helios). `createRawUpload()` still runs `CreateMultipartUploadCommand`/
 * `CompleteMultipartUploadCommand` server-to-server against the real
 * client; only the presigned URL itself is signed against
 * `resolvePresignEndpoint()`. Same credentials, same bucket — a different
 * endpoint is the only thing that needs to differ, so this is deliberately
 * not just `createMediaClient()` with a flag.
 */
export function createPresignClient(): S3Client {
  return new S3Client({
    endpoint: resolvePresignEndpoint(),
    region: "us-east-1",
    credentials: resolveCredentials(),
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

/**
 * Public URL builder, for a rendition the studio module records on an
 * asset. Relative by default (`/media/<prefix>/<file>`) so it works behind
 * whatever origin actually serves it (nginx in every real environment);
 * `MEDIA_PUBLIC_BASE_URL` overrides it for a case where the API and the
 * public site are not the same origin.
 */
export function publicMediaUrl(baseUrl: string, prefix: string, file: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/media/${prefix}/${file}`;
}

export interface CreateRawUploadInput {
  readonly assetId: string;
  readonly extension: string;
  readonly contentType: string;
  readonly partCount: number;
}

export interface RawUploadPart {
  readonly partNumber: number;
  readonly url: string;
}

export interface CreatedRawUpload {
  readonly key: string;
  readonly uploadId: string;
  readonly parts: readonly RawUploadPart[];
}

/** How long a presigned part URL stays valid — long enough for a slow upload, not indefinite. */
const PART_URL_TTL_SECONDS = 3600;

/**
 * Starts a real S3 multipart upload and presigns one PUT URL per part
 * (7.2.a). The client PUTs bytes straight to RustFS/R2 — this process never
 * sees the video — and returns each part's ETag for `completeRawUpload`.
 */
/**
 * `presignClient` defaults to `client` — local dev's own browser reaches
 * `S3_ENDPOINT` directly, so a single client suffices there. Staging/
 * production pass `createPresignClient()` (a real browser cannot reach
 * `S3_ENDPOINT`, loopback-only there) — found live, 2026-09-28.
 */
export async function createRawUpload(
  client: S3Client,
  input: CreateRawUploadInput,
  presignClient: S3Client = client,
): Promise<CreatedRawUpload> {
  await ensureStudioMediaBucket(client);
  const bucket = resolveMediaBucket();
  const key = rawObjectKey(input.assetId, input.extension);
  const created = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: input.contentType,
    }),
  );
  const uploadId = created.UploadId;
  if (uploadId === undefined) {
    throw new Error("CreateMultipartUploadCommand returned no UploadId");
  }

  const parts: RawUploadPart[] = [];
  for (let partNumber = 1; partNumber <= input.partCount; partNumber++) {
    const url = await getSignedUrl(
      presignClient,
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: PART_URL_TTL_SECONDS },
    );
    parts.push({ partNumber, url });
  }
  return { key, uploadId, parts };
}

export interface CompleteRawUploadInput {
  readonly key: string;
  readonly uploadId: string;
  readonly parts: readonly { readonly partNumber: number; readonly eTag: string }[];
}

export async function completeRawUpload(
  client: S3Client,
  input: CompleteRawUploadInput,
): Promise<void> {
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: resolveMediaBucket(),
      Key: input.key,
      UploadId: input.uploadId,
      MultipartUpload: {
        Parts: input.parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.eTag })),
      },
    }),
  );
}

export async function abortRawUpload(
  client: S3Client,
  input: { readonly key: string; readonly uploadId: string },
): Promise<void> {
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: resolveMediaBucket(),
      Key: input.key,
      UploadId: input.uploadId,
    }),
  );
}

/** Downloads the raw source so the worker can hand it to ffmpeg as a real file. */
export async function getRawObject(client: S3Client, key: string): Promise<Uint8Array> {
  const result = await client.send(
    new GetObjectCommand({ Bucket: resolveMediaBucket(), Key: key }),
  );
  const body = result.Body;
  if (body === undefined) throw new Error(`no object body for ${key}`);
  return body.transformToByteArray();
}

export type MediaOutputKind = "poster" | "teaser" | "captions" | "hls";

function contentTypeForOutput(kind: MediaOutputKind, file: string): string {
  if (kind === "poster") return "image/jpeg";
  if (kind === "teaser") return "video/mp4";
  if (kind === "captions") return "text/vtt";
  return hlsContentTypeFor(file);
}

/**
 * Uploads one produced rendition file to its public prefix.
 *
 * F63: unlike `createRawUpload`, this never called `ensureStudioMediaBucket`
 * — safe under MinIO, whose CI/dev container pre-creates a default bucket
 * on its own, but not under RustFS (F58-60's swap), which does not. A
 * caller that writes output WITHOUT going through `createRawUpload` first
 * (`runDemoMedia`'s own seed pipeline, which produces renditions directly
 * rather than through a browser's presigned multipart upload) hit
 * `NoSuchBucket` the moment MinIO's implicit pre-creation was gone.
 */
export async function putMediaOutput(
  client: S3Client,
  input: { readonly kind: MediaOutputKind; readonly key: string; readonly body: Uint8Array },
): Promise<void> {
  await ensureStudioMediaBucket(client);
  await client.send(
    new PutObjectCommand({
      Bucket: resolveMediaBucket(),
      Key: input.key,
      Body: input.body,
      ContentType: contentTypeForOutput(input.kind, input.key),
      CacheControl:
        input.kind === "hls" && input.key.endsWith(".m3u8")
          ? "no-cache"
          : "public, max-age=31536000, immutable",
    }),
  );
}

export { HLS_PREFIX };
