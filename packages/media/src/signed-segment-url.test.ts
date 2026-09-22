import { describe, expect, it } from "vitest";
import {
  SEGMENT_URL_TTL_MS,
  type SegmentClaims,
  attributableSession,
  issueSegmentToken,
  mintSegmentUrl,
  verifySegmentUrl,
} from "./signed-segment-url";

const SECRET = "test-segment-secret";
const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const SESSION = "session-abc";

function mint(overrides: Partial<Parameters<typeof mintSegmentUrl>[0]> = {}): string {
  return mintSegmentUrl({
    baseUrl: "http://127.0.0.1:26900/yourtal-media/hls",
    sessionId: SESSION,
    assetId: "attention-30s",
    renditionDir: "v0",
    segmentFile: "segment0.ts",
    nowMs: NOW,
    secret: SECRET,
    ...overrides,
  });
}

function tokenOf(url: string): string {
  const t = new URL(url).searchParams.get("t");
  if (t === null) throw new Error("no token in url");
  return t;
}

function verify(token: string, overrides: Record<string, unknown> = {}) {
  return verifySegmentUrl({
    token,
    requestedAssetId: "attention-30s",
    requestedRenditionDir: "v0",
    requestedSegmentFile: "segment0.ts",
    nowMs: NOW,
    secret: SECRET,
    ...overrides,
  });
}

describe("minting", () => {
  it("produces a URL for the requested object with a single token parameter", () => {
    const url = new URL(mint());

    expect(url.pathname).toBe("/yourtal-media/hls/attention-30s/v0/segment0.ts");
    expect([...url.searchParams.keys()]).toEqual(["t"]);
  });

  /**
   * The mistake this module exists to prevent. An adjacent `session=`
   * parameter validates perfectly while the caller picks the identity, and
   * the delivery log then faithfully records an attacker-chosen session.
   */
  it("never exposes the session as a separate query parameter", () => {
    const url = new URL(mint());

    expect(url.searchParams.get("session")).toBeNull();
    expect(url.search).not.toContain(SESSION);
  });

  it("round-trips through verification", () => {
    const verdict = verify(tokenOf(mint()));

    expect(verdict.accepted).toBe(true);
    expect(verdict.accepted && verdict.claims.sessionId).toBe(SESSION);
  });
});

describe("the session identity is inside the signature", () => {
  /**
   * The load-bearing test. Re-encoding the claims with a different session
   * must not verify -- otherwise the log records whoever the holder says
   * they are, and an authoritative-looking log is worse than none.
   */
  it("refuses a token whose session has been swapped", () => {
    const original = tokenOf(mint());
    const [encoded, signature] = original.split(".");
    const claims = JSON.parse(
      Buffer.from(encoded ?? "", "base64url").toString("utf8"),
    ) as SegmentClaims;

    const tampered = Buffer.from(
      JSON.stringify({ ...claims, sessionId: "attacker-session" }),
      "utf8",
    ).toString("base64url");

    const verdict = verify(`${tampered}.${signature ?? ""}`);

    expect(verdict.accepted).toBe(false);
    expect(!verdict.accepted && verdict.reason.kind).toBe("bad_signature");
  });

  it("refuses a token signed with a different secret", () => {
    const foreign = issueSegmentToken(
      {
        sessionId: SESSION,
        assetId: "attention-30s",
        renditionDir: "v0",
        segmentFile: "segment0.ts",
        expiresAtMs: NOW + SEGMENT_URL_TTL_MS,
      },
      "not-our-secret",
    );

    expect(verify(foreign).accepted).toBe(false);
  });
});

describe("binding is to one segment, not the asset", () => {
  /**
   * Without this, one signed URL unlocks the whole ladder and per-segment
   * granularity in the delivery log is decorative -- you would know which
   * URL was issued and never which bytes were taken.
   */
  it("refuses a token for a different segment of the same rendition", () => {
    const verdict = verify(tokenOf(mint()), { requestedSegmentFile: "segment7.ts" });

    expect(verdict.accepted).toBe(false);
    expect(!verdict.accepted && verdict.reason.kind).toBe("wrong_object");
  });

  it("refuses a token for the same segment index in another rendition", () => {
    const verdict = verify(tokenOf(mint()), { requestedRenditionDir: "v2" });

    expect(verdict.accepted).toBe(false);
    expect(!verdict.accepted && verdict.reason.kind).toBe("wrong_object");
  });

  it("refuses a token for another asset entirely", () => {
    const verdict = verify(tokenOf(mint()), { requestedAssetId: "some-other-asset" });

    expect(verdict.accepted).toBe(false);
  });

  /**
   * The requested object must come from the origin's routing, not from the
   * token. If verification compared the token against itself, any
   * well-signed token would open any object.
   */
  it("compares against the requested object rather than the token's own claims", () => {
    const url = mint({ renditionDir: "v1", segmentFile: "segment3.ts" });
    const matching = verify(tokenOf(url), {
      requestedRenditionDir: "v1",
      requestedSegmentFile: "segment3.ts",
    });
    const mismatched = verify(tokenOf(url));

    expect(matching.accepted).toBe(true);
    expect(mismatched.accepted).toBe(false);
  });
});

describe("expiry is sized against the segment, not the session", () => {
  it("accepts inside the window and refuses outside it", () => {
    const token = tokenOf(mint());

    expect(verify(token, { nowMs: NOW + SEGMENT_URL_TTL_MS - 1 }).accepted).toBe(true);
    expect(verify(token, { nowMs: NOW + SEGMENT_URL_TTL_MS + 1 }).accepted).toBe(false);
  });

  it("reports how stale an expired token is", () => {
    const verdict = verify(tokenOf(mint()), { nowMs: NOW + SEGMENT_URL_TTL_MS + 5_000 });

    expect(verdict.accepted).toBe(false);
    expect(!verdict.accepted && verdict.reason.kind).toBe("expired");
    expect(!verdict.accepted && verdict.reason.kind === "expired" && verdict.reason.ageMs).toBe(
      5_000,
    );
  });

  /**
   * A URL outliving the sitting is a shareable download link for the asset.
   * Pinned so that raising the TTL toward a session length is a decision
   * someone has to make deliberately, against a failing test.
   */
  it("expires far inside a viewing session", () => {
    const thirtyMinutes = 30 * 60 * 1000;
    expect(SEGMENT_URL_TTL_MS).toBeLessThan(thirtyMinutes / 10);
  });

  it("cannot be extended by editing the expiry, because it is signed", () => {
    const [encoded, signature] = tokenOf(mint()).split(".");
    const claims = JSON.parse(
      Buffer.from(encoded ?? "", "base64url").toString("utf8"),
    ) as SegmentClaims;

    const extended = Buffer.from(
      JSON.stringify({ ...claims, expiresAtMs: claims.expiresAtMs + 86_400_000 }),
      "utf8",
    ).toString("base64url");

    const verdict = verify(`${extended}.${signature ?? ""}`, { nowMs: NOW + 3_600_000 });

    expect(verdict.accepted).toBe(false);
    expect(!verdict.accepted && verdict.reason.kind).toBe("bad_signature");
  });
});

describe("malformed input", () => {
  it.each([
    ["empty", ""],
    ["no separator", "justonepart"],
    ["too many parts", "a.b.c"],
    ["empty signature", "abc."],
    ["empty payload", ".abc"],
  ])("refuses a %s token without throwing", (_label, token) => {
    const verdict = verify(token);
    expect(verdict.accepted).toBe(false);
  });

  /**
   * A correctly-signed payload that is not JSON must be malformed, not a
   * crash: the origin sees this from anyone probing it.
   */
  it("refuses a correctly signed payload that is not valid claims", () => {
    const junk = Buffer.from("not json at all", "utf8").toString("base64url");
    const token = `${junk}.${issueSegmentToken({} as SegmentClaims, SECRET).split(".")[1] ?? ""}`;

    expect(() => verify(token)).not.toThrow();
    expect(verify(token).accepted).toBe(false);
  });
});

describe("attributableSession", () => {
  /**
   * The log must record the session the SIGNATURE carried. Taking a verdict
   * rather than a session id means there is no way to call this without
   * having verified -- the unattributable log is not reachable through an
   * easier door.
   */
  it("yields the verified session for an accepted request", () => {
    expect(attributableSession(verify(tokenOf(mint())))).toBe(SESSION);
  });

  it("yields nothing for a refused one, so a rejected fetch cannot be attributed", () => {
    expect(
      attributableSession(verify(tokenOf(mint()), { requestedSegmentFile: "segment7.ts" })),
    ).toBe(undefined);
  });
});
