import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHlsUri } from "../../../shared/media-auth/hls-token";
import { mintManifestUrl } from "./mint-manifest-url";

const SECRET = "test-only-manifest-signing-secret-0123456789";
const HLS_URL = "http://127.0.0.1:26900/yourtal-media/hls/attention-30s/index.m3u8";

describe("mintManifestUrl", () => {
  it("mints a URL the same verifier hls-auth.controller uses accepts", () => {
    const sessionId = randomUUID();
    const now = 1_800_000_000;
    const url = mintManifestUrl({
      secret: SECRET,
      hlsUrl: HLS_URL,
      sessionId,
      durationSeconds: 30,
      nowSeconds: now,
    });

    expect(url).toMatch(
      /^\/media\/hls\/\d+\/[A-Za-z0-9_-]{43}\/[A-Za-z0-9-]+\/attention-30s\/index\.m3u8$/,
    );
    expect(verifyHlsUri(SECRET, url, now)).toBe("ok");
    // The signature covers the session, so a sibling segment under the
    // same directory inherits it (hls-token.ts's own header).
    expect(verifyHlsUri(SECRET, url.replace("index.m3u8", "v0/segment3.ts"), now)).toBe("ok");
  });

  it("refuses a tampered session id and a forged secret", () => {
    const url = mintManifestUrl({
      secret: SECRET,
      hlsUrl: HLS_URL,
      sessionId: "session-a",
      durationSeconds: 30,
      nowSeconds: 1_800_000_000,
    });
    expect(verifyHlsUri(SECRET, url.replace("session-a", "session-b"), 1_800_000_000)).toBe(
      "invalid",
    );
    expect(verifyHlsUri(`${SECRET}x`, url, 1_800_000_000)).toBe("invalid");
  });

  it("expires after the base TTL plus the campaign's own duration", () => {
    const now = 1_800_000_000;
    const url = mintManifestUrl({
      secret: SECRET,
      hlsUrl: HLS_URL,
      sessionId: "session-a",
      durationSeconds: 1_800,
      nowSeconds: now,
    });
    const oneSecondBeforeExpiry = now + 24 * 60 * 60 + 1_800 - 1;
    const oneSecondAfterExpiry = now + 24 * 60 * 60 + 1_800 + 1;
    expect(verifyHlsUri(SECRET, url, oneSecondBeforeExpiry)).toBe("ok");
    expect(verifyHlsUri(SECRET, url, oneSecondAfterExpiry)).toBe("expired");
  });

  it("falls back to the whole path for an hlsUrl with no /hls/ segment (fixture data never actually fetched through nginx)", () => {
    const now = 1_800_000_000;
    const url = mintManifestUrl({
      secret: SECRET,
      hlsUrl: "https://example.test/hls.m3u8",
      sessionId: "session-a",
      durationSeconds: 30,
      nowSeconds: now,
    });
    expect(url).toMatch(/\/hls\.m3u8$/);
    expect(verifyHlsUri(SECRET, url, now)).toBe("ok");
  });
});
