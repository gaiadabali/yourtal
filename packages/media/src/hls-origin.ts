import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the local HLS origin lives and what it serves. YT-0521.
 *
 * ## Why an origin at all, rather than a hosted stream
 *
 * Phase U pointed every campaign at one shared, publicly hosted reference
 * stream, because there was nowhere real to read a URL from. That made
 * YT-0412's keyboard-seeking criterion **untestable rather than failing**:
 * the stream's 59 MB segment aborted before the video element ever reported
 * a duration, and a seek cannot be asserted against a video with no duration.
 *
 * ## Why it is worth more than one player test
 *
 * `docs/22` audited the fraud controls `docs/08` relies on and found that
 * four of nine do not hold — including the one called the "strongest
 * web-native control": cross-checking a claimed playback position against
 * CDN segment-delivery logs. It does not hold on Cloudflare Stream, whose
 * analytics expose only date, datetime, uid, country and creator. **No
 * viewer, session, IP or segment dimension exists to cross-check against.**
 *
 * `docs/22`'s option A is to self-host HLS on object storage and log every
 * segment fetch. This is that, locally: RustFS speaks S3, so the same adapter
 * runs against R2 later, and every segment GET is a request the origin can
 * account for.
 *
 * ## A master playlist, so this can actually replace the placeholder
 *
 * `manifestUrl()` returns the **master** playlist, which lists three
 * renditions. The stream it replaces was picked for exactly that property —
 * `apps/web/features/player/video-source.ts` says it was chosen over a
 * single-bitrate file so the quality selector had something genuine to
 * switch between. A single-rendition fixture would have closed the seeking
 * gap by opening a quality-selection one.
 *
 * **What it proves and what it does not.** Delivery is an upper bound — "you
 * cannot claim more than was fetched" — not evidence a human watched.
 * `docs/22` is explicit that Cloudflare counts client-side preloading as
 * billable delivery and that a `curl` loop can pull every segment in
 * seconds. Treating a ceiling as proof of attention is the mistake `docs/08`
 * made. This origin makes the ceiling *measurable*, which is a real control
 * and a smaller one than the plan originally claimed.
 */

/** The bucket `.env.example` declares, and the one `publish-fixture` writes to. */
export const MEDIA_BUCKET = "yourtal-media";

/** Everything HLS lives under one prefix, so a bucket policy can scope to it. */
export const HLS_PREFIX = "hls";

/** The fixture this package ships. One asset, deliberately. */
export const FIXTURE_ASSET_ID = "attention-30s";

/**
 * The committed fixture's shape, asserted against the real files by
 * `hls-fixture.test.ts` and against the served bytes by `hls-origin.test.ts`.
 * `scripts/generate-fixture.mjs` produces exactly this.
 */
export const FIXTURE_SHAPE = {
  durationSeconds: 30,
  segmentSeconds: 4,
  segmentCount: 8,
  /**
   * Lowest rung first. Three renditions, not one: the placeholder this
   * replaces was chosen because it ships a real ABR ladder for the quality
   * selector to switch between, so a single-rendition fixture would have
   * fixed seeking and broken quality selection.
   */
  renditionDirs: ["v0", "v1", "v2"],
} as const;

export function fixtureDir(): string {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return path.join(packageRoot, "fixtures", FIXTURE_ASSET_ID);
}

/**
 * Object key for one file of an asset, e.g. `hls/attention-30s/index.m3u8`
 * or `hls/attention-30s/v1/segment3.ts`. `file` may contain a rendition
 * directory; forward slashes are the separator S3 uses, on every platform.
 */
export function objectKey(assetId: string, file: string): string {
  return `${HLS_PREFIX}/${assetId}/${file.split(path.sep).join("/")}`;
}

/**
 * The origin's base URL.
 *
 * Falls back to reading the repo's `.env`, the same way `packages/db`'s seed
 * and `scripts/atlas.mjs` do and for the same reason: `pnpm` does not load
 * `.env`, so without this a script run through the workspace finds nothing.
 */
export function resolveOriginEndpoint(): string {
  return readEnv("S3_ENDPOINT") ?? "http://127.0.0.1:26900";
}

/**
 * The endpoint a real BROWSER's presigned PUT is signed against — found
 * live on staging (2026-09-28): the api signs upload parts using its own
 * `S3_ENDPOINT`, which on Helios is `http://127.0.0.1:26305`, loopback and
 * unreachable from outside the box. Local dev needs no override (a
 * developer's own browser reaches `S3_ENDPOINT` directly), so this only
 * differs from `resolveOriginEndpoint()` where `MEDIA_PRESIGN_ENDPOINT` is
 * explicitly set — staging/production, pointed at the deployed origin
 * (e.g. `https://yourtal.gaiada.com`), with nginx passing the bucket path
 * straight through to RustFS unchanged (SigV4 signs the request path, so
 * nginx must not rewrite or strip it — only forward the original `Host`
 * header, since `SignedHeaders` covers that too). See
 * `infra/helios/nginx/yourtal.gaiada.com.conf`'s own `/<bucket>/` location.
 */
export function resolvePresignEndpoint(): string {
  return readEnv("MEDIA_PRESIGN_ENDPOINT") ?? resolveOriginEndpoint();
}

/**
 * The bucket real (non-fixture) media lives in. `MEDIA_BUCKET` above stays a
 * hard-coded constant on purpose — the `attention-30s` fixture is shared,
 * read-only, and the same asset in every environment, so there is nothing to
 * configure. Studio's uploads (7.2) are real tenant data, and a parallel
 * phase session isolates its own with its own bucket (`S3_BUCKET` in its
 * `.env`) so two sessions' `pnpm demo:media` runs never collide. Staging has
 * exactly one bucket (`yourtal-media`, matching `infra/helios/nginx`'s
 * hard-coded proxy path), so this and `MEDIA_BUCKET` agree there.
 */
export function resolveMediaBucket(): string {
  return readEnv("S3_BUCKET") ?? MEDIA_BUCKET;
}

/**
 * The bucket's CORS allowlist (F58): a browser PUTs presigned upload parts,
 * and reads the HLS fixture, straight from this origin — cross-origin from
 * the studio UI / player's own origin. `*` is refused on purpose (the
 * founder's call, 2026-09-28): an object store one config typo away from
 * `s3:GetObject` on `*` is not the place for a wildcard CORS rule too.
 *
 * `MEDIA_CORS_ORIGINS` (comma-separated) wins if set; else a single
 * `SITE_URL` (the deployed web origin, `apps/web`'s own build-time var);
 * else the two local dev addresses `apps/web` actually runs on.
 */
export function resolveMediaCorsOrigins(): readonly string[] {
  const configured = readEnv("MEDIA_CORS_ORIGINS");
  if (configured !== undefined) {
    const origins = configured
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
    if (origins.length > 0) return origins;
  }
  const siteUrl = readEnv("SITE_URL");
  if (siteUrl !== undefined && siteUrl.length > 0) return [siteUrl];
  return ["http://localhost:3000", "http://127.0.0.1:3000"];
}

interface BucketPolicyStatement {
  readonly Resource?: readonly string[] | string;
}
interface BucketPolicyDocument {
  readonly Statement?: readonly BucketPolicyStatement[];
}

function isBucketPolicyDocument(value: unknown): value is BucketPolicyDocument {
  return typeof value === "object" && value !== null;
}

/**
 * The full set of ARNs a bucket policy's statements grant `Resource` on —
 * shared by `studio-media.ts`'s `ensureStudioMediaBucket` and
 * `publish-fixture.ts`'s `allowAnonymousReadOfHls`, both of which only
 * CHECK a policy is already present (F58) rather than setting one.
 */
export function bucketPolicyResources(policyJson: string | undefined): ReadonlySet<string> {
  if (!policyJson) return new Set();
  const parsed: unknown = JSON.parse(policyJson);
  if (!isBucketPolicyDocument(parsed) || !parsed.Statement) return new Set();
  const resources: string[] = [];
  for (const statement of parsed.Statement) {
    const resource: unknown = statement.Resource;
    if (Array.isArray(resource)) {
      for (const entry of resource) if (typeof entry === "string") resources.push(entry);
    } else if (typeof resource === "string") {
      resources.push(resource);
    }
  }
  return new Set(resources);
}

export function resolveCredentials(): { accessKeyId: string; secretAccessKey: string } {
  const isProduction = process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";
  // In production, require the env var to be set explicitly (do not fall back to .env).
  if (isProduction && !process.env.S3_SECRET_KEY) {
    throw new Error(
      "S3_SECRET_KEY environment variable is required in production; set it as an env var",
    );
  }

  const secretAccessKey = readEnv("S3_SECRET_KEY");
  return {
    accessKeyId: readEnv("S3_ACCESS_KEY") ?? "yourtal",
    secretAccessKey: secretAccessKey ?? "yourtal_local_only",
  };
}

/** The URL a player fetches. Anonymous: an origin serves a CDN, not a client. */
export function manifestUrl(assetId: string = FIXTURE_ASSET_ID): string {
  return `${resolveOriginEndpoint()}/${MEDIA_BUCKET}/${objectKey(assetId, "index.m3u8")}`;
}

/** A segment of one rendition. `renditionDir` defaults to the lowest rung. */
export function segmentUrl(
  assetId: string,
  segmentIndex: number,
  renditionDir: string = FIXTURE_SHAPE.renditionDirs[0],
): string {
  const key = objectKey(assetId, `${renditionDir}/segment${String(segmentIndex)}.ts`);
  return `${resolveOriginEndpoint()}/${MEDIA_BUCKET}/${key}`;
}

/** One rendition's own playlist, which the master references. */
export function variantPlaylistUrl(assetId: string, renditionDir: string): string {
  return `${resolveOriginEndpoint()}/${MEDIA_BUCKET}/${objectKey(assetId, `${renditionDir}/index.m3u8`)}`;
}

/**
 * Content types HLS actually requires.
 *
 * Not cosmetic. Safari refuses a manifest that is not
 * `application/vnd.apple.mpegurl`, and a segment served as
 * `application/octet-stream` is a demux failure rather than a clear error —
 * which is the kind of bug that reads as "the video is broken" for a day.
 */
export function contentTypeFor(file: string): string {
  if (file.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (file.endsWith(".ts")) return "video/mp2t";
  throw new Error(`No content type is defined for ${file}; HLS serves only .m3u8 and .ts here`);
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
