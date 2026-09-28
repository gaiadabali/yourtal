import { afterEach, describe, expect, it } from "vitest";
import { publicMediaUrl } from "./hls-origin";

/**
 * F61-adjacent (found 2026-09-28, 7.9.d): `transcode.ts` (7.2.b) stored
 * `posterUrl`/`teaserUrl`/`hlsUrl` as a bare `/media/…` path — not a valid
 * `campaignSchema` URL (`z.url()` requires a scheme) and not something
 * `mint-manifest-url.ts`'s `new URL(hlsUrl)` can parse. Every campaign
 * whose media reached "ready" was silently dropped from the public read
 * path (`findVisibleById`, the feed, search) and starting to watch one
 * directly threw. Proven live on staging: a demo campaign's own poster/
 * teaser load fine directly through nginx, but `POST /api/watch/sessions`
 * against it returned `404 "No such campaign."` even though
 * `campaign.campaigns.lifecycle_state` was `'live'` — `campaignSchema`
 * silently failed to parse the row.
 */
const originalPresign = process.env["MEDIA_PRESIGN_ENDPOINT"];
const originalOrigin = process.env["S3_ENDPOINT"];
const originalBucket = process.env["S3_BUCKET"];

afterEach(() => {
  if (originalPresign === undefined) delete process.env["MEDIA_PRESIGN_ENDPOINT"];
  else process.env["MEDIA_PRESIGN_ENDPOINT"] = originalPresign;
  if (originalOrigin === undefined) delete process.env["S3_ENDPOINT"];
  else process.env["S3_ENDPOINT"] = originalOrigin;
  if (originalBucket === undefined) delete process.env["S3_BUCKET"];
  else process.env["S3_BUCKET"] = originalBucket;
});

describe("publicMediaUrl", () => {
  it("is always an absolute, well-formed URL (campaignSchema's own z.url() requirement)", () => {
    delete process.env["MEDIA_PRESIGN_ENDPOINT"];
    process.env["S3_ENDPOINT"] = "http://127.0.0.1:26900";
    process.env["S3_BUCKET"] = "yourtal-media";
    const url = publicMediaUrl("posters/abc.jpg");
    expect(() => new URL(url)).not.toThrow();
  });

  it("local dev (no MEDIA_PRESIGN_ENDPOINT): reads straight off the bucket, S3-path-style", () => {
    delete process.env["MEDIA_PRESIGN_ENDPOINT"];
    process.env["S3_ENDPOINT"] = "http://127.0.0.1:26900";
    process.env["S3_BUCKET"] = "yourtal-media";
    expect(publicMediaUrl("posters/abc.jpg")).toBe(
      "http://127.0.0.1:26900/yourtal-media/posters/abc.jpg",
    );
  });

  it("staging/production: uses MEDIA_PRESIGN_ENDPOINT (the deployed site origin) and nginx's /media/ prefix, never the loopback-only S3_ENDPOINT", () => {
    process.env["S3_ENDPOINT"] = "http://127.0.0.1:26305";
    process.env["MEDIA_PRESIGN_ENDPOINT"] = "https://yourtal.gaiada.com";
    expect(publicMediaUrl("posters/abc.jpg")).toBe(
      "https://yourtal.gaiada.com/media/posters/abc.jpg",
    );
  });

  it("an hls key's path still contains an /hls/ segment mint-manifest-url.ts can find", () => {
    process.env["S3_ENDPOINT"] = "http://127.0.0.1:26305";
    process.env["MEDIA_PRESIGN_ENDPOINT"] = "https://yourtal.gaiada.com";
    const url = publicMediaUrl("hls/campaign-id/index.m3u8");
    expect(new URL(url).pathname).toContain("/hls/");
  });
});
