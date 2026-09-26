import { signHlsPath } from "../../../shared/media-auth/hls-token";

/**
 * A per-session, signed manifest URL (EW-18, 5.1.d/5.6.a) — the SAME scheme
 * `shared/media-auth/hls-token.ts` signs and `/api/internal/hls-auth`
 * verifies for nginx's `auth_request` (2.1.c). Replaces `segment-url-stub.ts`
 * (deliberately unsigned, "until `@yourtal/media` exports `mintSegmentUrl`
 * with the same scheme" — `packages/media/src/signed-segment-url.ts` exists
 * but signs a DIFFERENT scheme (an opaque `?t=` token per segment object,
 * not the path-embedded session token nginx's vhost checks), and is not
 * exported from that package. Reimplementing nginx's actual scheme a second
 * time is exactly what that stub's own header warns against, so this calls
 * `hls-token.ts` directly rather than either).
 *
 * Relative, not absolute: nginx fronts `/media/hls/` on the same public
 * origin `/api/` is already served from (infra/helios/nginx), so the
 * browser resolves this against whatever origin it reached
 * `POST /api/watch/sessions` on on, in every environment, with no separate
 * "public media origin" to configure or drift from that vhost.
 */

/**
 * How long a session's signed manifest URL stays valid, on top of the
 * campaign's own duration.
 *
 * `start`'s whole response — this URL included — is cached and replayed for
 * `SESSION_START_RETENTION_MS` (24h) by `@Idempotent` (5.1.b), so the
 * signature must outlive THAT window, not just the video's length: a
 * resumed session replayed from the idempotency cache must not receive an
 * already-expired URL. `durationSeconds` on top covers genuinely long
 * playback once the URL is in use.
 */
export const MANIFEST_URL_BASE_TTL_SECONDS = 24 * 60 * 60;

export interface MintManifestUrlInput {
  readonly secret: string;
  /** The campaign's own asset URL, e.g. `http://host/yourtal-media/hls/<assetId>/index.m3u8`. */
  readonly hlsUrl: string;
  readonly sessionId: string;
  readonly durationSeconds: number;
  /** Overridable for tests; defaults to the real clock. */
  readonly nowSeconds?: number;
}

export function mintManifestUrl(input: MintManifestUrlInput): string {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const expires = now + MANIFEST_URL_BASE_TTL_SECONDS + Math.max(input.durationSeconds, 0);
  return signHlsPath(input.secret, input.sessionId, hlsRelativePath(input.hlsUrl), expires);
}

/**
 * The object key under the bucket's `hls/` prefix — the same path nginx's
 * `location ~ ^/media/hls/...` extracts as `$yt_hls_path` and proxies
 * straight to storage. Kept to the PATH only (never the stored URL's own
 * host): dev, staging and a real per-encode host can each name that host
 * differently, and only the relative key under `hls/` is ever meaningful
 * once the browser is fetching through nginx's own vhost instead.
 *
 * Falls back to the whole pathname when there is no `/hls/` segment to
 * strip (e.g. a test fixture's `https://example.test/hls.m3u8`, never
 * actually fetched through nginx) — `hls-token.ts`'s own path segment is
 * unconstrained in shape, so a well-formed-but-not-bucket-shaped path
 * still signs and verifies correctly; only real seeded/published data is
 * ever expected to resolve through the real storage origin.
 */
function hlsRelativePath(hlsUrl: string): string {
  const marker = "/hls/";
  const pathname = new URL(hlsUrl).pathname;
  const index = pathname.indexOf(marker);
  const relative = index === -1 ? pathname : pathname.slice(index + marker.length);
  return relative.replace(/^\/+/, "");
}
