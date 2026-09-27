import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `signedSegmentUrl()` (TASKS.md 7.2.c), for B's 5.1.d. Must produce EXACTLY
 * the scheme `apps/api/src/shared/media-auth/hls-token.ts` documents and
 * `HlsAuthController`/nginx's `secure_link`-equivalent `auth_request` verify:
 *
 *   /media/hls/<expiresUnixSeconds>/<token>/<sessionId>/<path>
 *   token = base64url(HMAC-SHA256(secret, "<expires>.<sessionId>"))
 *
 * ## Why this is a second implementation of the same three lines, not an import
 *
 * `hls-token.ts` lives under `apps/api/src/shared/**`, Area A's (TASKS.md's
 * "Areas and ownership"). `packages/media` is Area C's. Importing across
 * that boundary would make a media-pipeline package depend on the API app's
 * internals for three lines of HMAC arithmetic — the algorithm is the
 * contract, stated in that file's own doc comment, and is public enough to
 * restate here the way `watch/5.6.a` already restates its reasoning rather
 * than reaching into `packages/media` for it. `hls-session-url.test.ts`
 * pins the exact byte format so the two cannot drift silently.
 *
 * ## Why B did not end up calling this
 *
 * By 5.6.a, `watch.module.ts` already called `signHlsPath` directly (the
 * task's own stated fallback, "swap ... only if 7.2.c exports one with the
 * same scheme"), and that path works and is merged. This export exists so
 * that swap is available — same scheme, one call — not because anything is
 * broken today.
 */
const HLS_PATH = /^\/media\/hls\/(\d{1,12})\/([A-Za-z0-9_-]{43})\/([A-Za-z0-9-]{1,64})\/(.+)$/;

export type HlsSessionVerdict = "ok" | "invalid" | "expired";

function hlsToken(secret: string, expires: number, sessionId: string): string {
  return createHmac("sha256", secret)
    .update(`${String(expires)}.${sessionId}`)
    .digest("base64url");
}

export interface SignedSegmentUrlInput {
  readonly secret: string;
  readonly sessionId: string;
  /** The manifest or segment path relative to the asset, e.g. "index.m3u8" or "v0/segment3.ts". */
  readonly path: string;
  readonly expiresAtUnixSeconds: number;
}

/** The relative `/media/hls/...` path — nginx and the web app both take a path, never a host. */
export function signedSegmentUrl(input: SignedSegmentUrlInput): string {
  const token = hlsToken(input.secret, input.expiresAtUnixSeconds, input.sessionId);
  return `/media/hls/${String(input.expiresAtUnixSeconds)}/${token}/${input.sessionId}/${input.path}`;
}

export function verifySignedSegmentUrl(
  secret: string,
  uri: string,
  nowSeconds: number,
): HlsSessionVerdict {
  const match = HLS_PATH.exec(uri.split("?")[0] ?? "");
  if (!match) return "invalid";
  const [, expiresRaw, token, sessionId, path] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (path.split("/").includes("..")) return "invalid";
  const expected = Buffer.from(hlsToken(secret, Number(expiresRaw), sessionId));
  const given = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "invalid";
  return Number(expiresRaw) < nowSeconds ? "expired" : "ok";
}
