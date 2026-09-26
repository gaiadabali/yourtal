import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Per-session HLS URLs (EW-18, 5.1.d), checked by nginx through
 * `auth_request` on every manifest and segment:
 *
 *   /media/hls/<expiresUnixSeconds>/<token>/<sessionId>/<path>
 *   token = base64url(HMAC-SHA256(secret, "<expires>.<sessionId>"))
 *
 * The token covers the session, not the file, so the relative segment URLs
 * inside a manifest inherit it. `packages/media`'s `signedSegmentUrl()`
 * (7.2.c) must produce exactly this shape.
 */
const HLS_PATH = /^\/media\/hls\/(\d{1,12})\/([A-Za-z0-9_-]{43})\/([A-Za-z0-9-]{1,64})\/(.+)$/;

export type HlsVerdict = "ok" | "invalid" | "expired";

export function hlsToken(secret: string, expires: number, sessionId: string): string {
  return createHmac("sha256", secret).update(`${expires}.${sessionId}`).digest("base64url");
}

export function signHlsPath(
  secret: string,
  sessionId: string,
  path: string,
  expires: number,
): string {
  return `/media/hls/${expires}/${hlsToken(secret, expires, sessionId)}/${sessionId}/${path}`;
}

export function verifyHlsUri(secret: string, uri: string, nowSeconds: number): HlsVerdict {
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
