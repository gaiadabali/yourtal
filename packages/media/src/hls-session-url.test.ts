import { describe, expect, it } from "vitest";
import { signedSegmentUrl, verifySignedSegmentUrl } from "./hls-session-url";

const SECRET = "test-only-hls-signing-secret-not-real-not-real";

describe("signedSegmentUrl", () => {
  const input = {
    secret: SECRET,
    sessionId: "a".repeat(43),
    path: "v0/segment3.ts",
    expiresAtUnixSeconds: 2_000_000_000,
  };

  it("matches hls-token.ts's documented shape exactly", () => {
    const url = signedSegmentUrl(input);
    expect(url).toMatch(
      /^\/media\/hls\/\d{1,12}\/[A-Za-z0-9_-]{43}\/[A-Za-z0-9-]{1,64}\/v0\/segment3\.ts$/,
    );
  });

  it("round-trips through verifySignedSegmentUrl", () => {
    const url = signedSegmentUrl(input);
    expect(verifySignedSegmentUrl(SECRET, url, 1)).toBe("ok");
  });

  it("refuses a tampered session id", () => {
    const url = signedSegmentUrl(input);
    const tampered = url.replace(input.sessionId, "b".repeat(43));
    expect(verifySignedSegmentUrl(SECRET, tampered, 1)).toBe("invalid");
  });

  it("refuses the wrong secret", () => {
    const url = signedSegmentUrl(input);
    expect(verifySignedSegmentUrl("a-different-secret-entirely-000", url, 1)).toBe("invalid");
  });

  it("expires", () => {
    const url = signedSegmentUrl({ ...input, expiresAtUnixSeconds: 100 });
    expect(verifySignedSegmentUrl(SECRET, url, 101)).toBe("expired");
  });
});
