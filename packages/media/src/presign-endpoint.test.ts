import { afterEach, describe, expect, it } from "vitest";
import { resolvePresignEndpoint } from "./hls-origin";

/**
 * Found live on staging (2026-09-28): a real browser cannot reach
 * `S3_ENDPOINT` (loopback-only there), so a presigned upload URL signed
 * against it 404s/times out for every real client. `MEDIA_PRESIGN_ENDPOINT`
 * is the override; this proves the precedence, not the S3 signing itself
 * (already covered by `studio-media.test.ts`'s real round trip).
 */
const originalPresign = process.env["MEDIA_PRESIGN_ENDPOINT"];
const originalOrigin = process.env["S3_ENDPOINT"];

afterEach(() => {
  if (originalPresign === undefined) delete process.env["MEDIA_PRESIGN_ENDPOINT"];
  else process.env["MEDIA_PRESIGN_ENDPOINT"] = originalPresign;
  if (originalOrigin === undefined) delete process.env["S3_ENDPOINT"];
  else process.env["S3_ENDPOINT"] = originalOrigin;
});

describe("resolvePresignEndpoint", () => {
  it("falls back to the origin endpoint when unset (local dev's own case)", () => {
    delete process.env["MEDIA_PRESIGN_ENDPOINT"];
    process.env["S3_ENDPOINT"] = "http://127.0.0.1:26900";
    expect(resolvePresignEndpoint()).toBe("http://127.0.0.1:26900");
  });

  it("overrides to MEDIA_PRESIGN_ENDPOINT when set (staging/production)", () => {
    process.env["S3_ENDPOINT"] = "http://127.0.0.1:26305";
    process.env["MEDIA_PRESIGN_ENDPOINT"] = "https://yourtal.gaiada.com";
    expect(resolvePresignEndpoint()).toBe("https://yourtal.gaiada.com");
    // And the internal-only origin endpoint is unaffected by the override —
    // CreateMultipartUploadCommand/CompleteMultipartUploadCommand still run
    // server-to-server against the real loopback address.
  });
});
