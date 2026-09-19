import { beforeAll, describe, expect, it } from "vitest";
import {
  FIXTURE_ASSET_ID,
  FIXTURE_SHAPE,
  manifestUrl,
  resolveOriginEndpoint,
  segmentUrl,
  variantPlaylistUrl,
} from "./hls-origin";
import { publishFixture } from "./publish-fixture";

/**
 * The origin, against the real MinIO from `pnpm dev:up`. YT-0521.
 *
 * Every request here is **anonymous** — no SDK, no credentials, plain
 * `fetch`, exactly what a player does. Asserting through the S3 client would
 * prove the objects exist; it would not prove they are reachable by the one
 * consumer that matters, and the bucket policy is the part most likely to be
 * wrong.
 *
 * Fails rather than skips when MinIO is down, matching `packages/db`. A media
 * origin test that passes on a machine with no origin is worth nothing.
 */

beforeAll(async () => {
  await publishFixture();
});

async function fetchOrThrow(url: string, headers?: Record<string, string>): Promise<Response> {
  const response = await fetch(url, headers === undefined ? undefined : { headers });
  if (!response.ok) {
    throw new Error(`${url} returned ${String(response.status)} ${response.statusText}`);
  }
  return response;
}

describe("the local HLS origin", () => {
  it("serves the master playlist anonymously, as the Apple media type", async () => {
    const response = await fetchOrThrow(manifestUrl());

    // Safari rejects a manifest served as anything else, and the failure is
    // a silent non-play rather than an error anyone can read.
    expect(response.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(await response.text()).toContain("#EXT-X-STREAM-INF");
  });

  it("advertises a ladder whose bandwidth rises with resolution", async () => {
    const master = await (await fetchOrThrow(manifestUrl())).text();
    // `[:,]` anchors the match, because every STREAM-INF line also carries
    // AVERAGE-BANDWIDTH — a bare /BANDWIDTH=/ finds six values in a
    // three-rung ladder and the monotonic check then compares a rung's
    // average against the next rung's peak, which is not a real ordering.
    const bandwidths = [...master.matchAll(/[:,]BANDWIDTH=(\d+)/g)].map((match) =>
      Number(match[1] ?? "0"),
    );

    expect(bandwidths).toHaveLength(FIXTURE_SHAPE.renditionDirs.length);
    // hls.js selects by BANDWIDTH. A ladder whose top rung advertises less
    // than its middle one selects incoherently, and the player's quality
    // control stops meaning anything — which would have traded YT-0412's
    // seeking gap for a quality-selection one.
    for (const [index, bandwidth] of bandwidths.entries()) {
      if (index > 0) {
        expect(bandwidth).toBeGreaterThan(bandwidths[index - 1] ?? 0);
      }
    }
  });

  it("serves every segment of every rendition", async () => {
    for (const rendition of FIXTURE_SHAPE.renditionDirs) {
      const playlist = await (
        await fetchOrThrow(variantPlaylistUrl(FIXTURE_ASSET_ID, rendition))
      ).text();
      expect(playlist).toContain("#EXT-X-ENDLIST");

      const segments = playlist.split(/\r?\n/).filter((line) => line.endsWith(".ts"));
      expect(segments).toHaveLength(FIXTURE_SHAPE.segmentCount);

      for (const [index] of segments.entries()) {
        const response = await fetchOrThrow(segmentUrl(FIXTURE_ASSET_ID, index, rendition));
        expect(response.headers.get("content-type")).toBe("video/mp2t");

        const bytes = new Uint8Array(await response.arrayBuffer());
        expect(bytes.length).toBeGreaterThan(1_000);
        // Transport-stream sync byte: the bytes really are a segment, not an
        // error page served with a 200 and the right content type.
        expect(bytes[0]).toBe(0x47);
      }
    }
  });

  it("lets a browser read it cross-origin", async () => {
    // The player runs on localhost:3000 and the origin is on 127.0.0.1:26900
    // — a different origin by both host and port. Without this header the
    // fetch fails in the browser and nowhere else, so it is invisible to
    // every test that is not this one.
    const response = await fetchOrThrow(manifestUrl(), { Origin: "http://localhost:3000" });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  it("caches segments hard and the manifest not at all", async () => {
    const manifest = await fetchOrThrow(manifestUrl());
    const segment = await fetchOrThrow(segmentUrl(FIXTURE_ASSET_ID, 0));

    // A segment is immutable once written; a manifest is rewritten in place
    // for a live stream, and a cached one strands the player on a stale
    // segment list. This fixture is VOD, but the rule belongs to the type.
    expect(manifest.headers.get("cache-control")).toBe("no-cache");
    expect(segment.headers.get("cache-control")).toContain("immutable");
  });

  it("publishes nothing outside the hls prefix", async () => {
    // The bucket policy grants anonymous GetObject under `hls/` only, because
    // `S3_BUCKET` is the whole stack's bucket: KYB documents and receipt
    // uploads land here too. A bucket-wide public policy would publish them.
    const response = await fetch(
      `${resolveOriginEndpoint()}/yourtal-media/kyb/should-not-exist.pdf`,
    );
    expect(response.ok).toBe(false);
    expect([403, 404]).toContain(response.status);
  });
});
