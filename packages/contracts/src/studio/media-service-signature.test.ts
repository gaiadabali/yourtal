import { describe, expect, it } from "vitest";
import {
  signMediaServiceRequest,
  verifyMediaServiceRequest,
  MEDIA_SIGNATURE_WINDOW_SECONDS,
} from "./media-service-signature";

const SECRET = "test-only-media-service-secret-not-real-not-real";

describe("media service signature", () => {
  const base = {
    secret: SECRET,
    method: "POST",
    pathAndQuery: "/internal/studio/media/abc/ready",
    body: JSON.stringify({ status: "ready" }),
    unixSeconds: 1_000_000,
  };

  it("accepts its own signature", () => {
    const header = signMediaServiceRequest(base);
    expect(verifyMediaServiceRequest({ ...base, header })).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const header = signMediaServiceRequest(base);
    expect(
      verifyMediaServiceRequest({ ...base, body: JSON.stringify({ status: "failed" }), header }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a forged secret", () => {
    const header = signMediaServiceRequest({ ...base, secret: "a-different-secret-entirely-xx" });
    expect(verifyMediaServiceRequest({ ...base, header })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyMediaServiceRequest({ ...base, header: undefined })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyMediaServiceRequest({ ...base, header: "garbage" })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects an expired signature", () => {
    const header = signMediaServiceRequest(base);
    const laterSeconds = base.unixSeconds + MEDIA_SIGNATURE_WINDOW_SECONDS + 1;
    expect(verifyMediaServiceRequest({ ...base, header, unixSeconds: laterSeconds })).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
