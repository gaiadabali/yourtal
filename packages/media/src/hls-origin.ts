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
 * segment fetch. This is that, locally: MinIO speaks S3, so the same adapter
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
export const FIXTURE_ASSET_ID = "attention-20s";

/**
 * The committed fixture's shape, asserted against the real files by
 * `hls-fixture.test.ts` and against the served bytes by `hls-origin.test.ts`.
 * `scripts/generate-fixture.mjs` produces exactly this.
 */
export const FIXTURE_SHAPE = {
  durationSeconds: 20,
  segmentSeconds: 4,
  segmentCount: 5,
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
 * Object key for one file of an asset, e.g. `hls/attention-20s/index.m3u8`
 * or `hls/attention-20s/v1/segment3.ts`. `file` may contain a rendition
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

export function resolveCredentials(): { accessKeyId: string; secretAccessKey: string } {
  return {
    accessKeyId: readEnv("S3_ACCESS_KEY") ?? "yourtal",
    secretAccessKey: readEnv("S3_SECRET_KEY") ?? "yourtal_local_only",
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
