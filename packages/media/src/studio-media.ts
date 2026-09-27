import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  contentTypeFor as hlsContentTypeFor,
  HLS_PREFIX,
  objectKey as hlsObjectKey,
  resolveCredentials,
  resolveMediaBucket,
  resolveOriginEndpoint,
} from "./hls-origin";

/**
 * The studio media pipeline's object layout (TASKS.md 7.2), on the SAME
 * bucket `hls-origin.ts` already publishes the player fixture to. Every
 * prefix here matches `infra/helios/nginx/yourtal.gaiada.com.conf`
 * (2.1.c) exactly: `posters/`, `teasers/`, `captions/` are proxied public
 * and read-only, `hls/` is proxied behind the per-session signature, and
 * anything else under `/media/` 404s — which is why raw uploads live under
 * `raw/` and are never served through nginx at all, only read by the worker
 * directly off MinIO (loopback-only in production).
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
 * NO S3 credentials attached to that proxy — MinIO/R2 has to allow
 * anonymous `GetObject` on all four, or nginx serves a 403 for every asset
 * this pipeline produces. `publish-fixture.ts`'s own `allowAnonymousReadOfHls`
 * only ever covered `hls/`, because it predates uploaded (non-fixture)
 * media entirely; this is its studio-pipeline twin, covering the other
 * three prefixes nginx also serves.
 */
const PUBLIC_READ_PREFIXES = [HLS_PREFIX, POSTER_PREFIX, TEASER_PREFIX, CAPTIONS_PREFIX];

/** Memoised per bucket name: called on every upload, but the PUT itself only needs to happen once. */
const policyEnsured = new Set<string>();

async function ensureStudioMediaBucket(client: S3Client): Promise<void> {
  const bucket = resolveMediaBucket();
  if (policyEnsured.has(bucket)) return;

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "PublicReadStudioMedia",
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: PUBLIC_READ_PREFIXES.map((prefix) => `arn:aws:s3:::${bucket}/${prefix}/*`),
          },
        ],
      }),
    }),
  );
  policyEnsured.add(bucket);
}

export function createMediaClient(): S3Client {
  return new S3Client({
    endpoint: resolveOriginEndpoint(),
    region: "us-east-1", // MinIO ignores it; the SDK refuses to run without one.
    credentials: resolveCredentials(),
    forcePathStyle: true,
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
 * (7.2.a). The client PUTs bytes straight to MinIO/R2 — this process never
 * sees the video — and returns each part's ETag for `completeRawUpload`.
 */
export async function createRawUpload(
  client: S3Client,
  input: CreateRawUploadInput,
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
      client,
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

/** Uploads one produced rendition file to its public prefix. */
export async function putMediaOutput(
  client: S3Client,
  input: { readonly kind: MediaOutputKind; readonly key: string; readonly body: Uint8Array },
): Promise<void> {
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
