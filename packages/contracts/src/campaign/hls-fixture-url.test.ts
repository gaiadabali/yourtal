import { describe, expect, it } from "vitest";
import { manifestUrl } from "@yourtal/media/hls-origin";
import { MOCK_HLS_MANIFEST_URL } from "./campaign.mock";
import { campaignVideoSourceSchema } from "./campaign-video-source";
import { mockCampaigns } from "./campaign.mock";
import { generateAuCampaigns } from "../region/region-mock-au-campaign";

/**
 * The mock manifest URL still points at something the origin serves.
 * YT-0526.
 *
 * ## Why a guarded copy instead of an import
 *
 * `packages/contracts` sits upstream of every other package and must not
 * depend on `packages/media` — a contract that needed the media package to
 * load would drag object storage into anything reading a campaign. So the
 * URL is a literal in `campaign.mock.ts`, and this test is what stops it
 * becoming an unguarded duplicate.
 *
 * The dependency runs the other way and only in tests: `@yourtal/media` is a
 * devDependency here, and the media package imports nothing from contracts,
 * so nothing cyclic exists at runtime or at build.
 *
 * ## Why it lives in this package rather than in media
 *
 * It fails where the mistake is made. Someone editing the mock URL gets a
 * red `pnpm --filter @yourtal/contracts test` in the same command, rather
 * than a failure surfacing later inside a package they were not touching —
 * which is the delay the contracts/migrations drift gate exists to remove,
 * applied to the same class of problem.
 */

describe("the mock campaign manifest URL", () => {
  it("is the one the media package publishes", () => {
    // `manifestUrl()` reads S3_ENDPOINT, so this also catches the case where
    // the origin moves port and the mocks keep pointing at the old one.
    expect(MOCK_HLS_MANIFEST_URL).toBe(manifestUrl());
  });

  it("is a valid video source, not merely a string", () => {
    const parsed = campaignVideoSourceSchema.safeParse({
      kind: "hls",
      manifestUrl: MOCK_HLS_MANIFEST_URL,
    });
    expect(parsed.success).toBe(true);
  });

  it("no longer points at a third-party CDN", () => {
    // The placeholder was Apple's public reference stream. Every player test
    // reaching for it meant an offline machine — or Apple moving the asset —
    // failed the suite with a network error, which is a dependency no test
    // should have on a vendor nobody has an agreement with.
    expect(MOCK_HLS_MANIFEST_URL).not.toContain("apple.com");
    expect(MOCK_HLS_MANIFEST_URL).not.toContain("devstreaming");
  });

  it("is used by every mock campaign in both regions", () => {
    // Both regions, because this URL was duplicated in two files and
    // repointing one of them is exactly the half-migration that leaves the
    // AU catalogue playing something the origin does not serve.
    for (const campaign of [...mockCampaigns, ...generateAuCampaigns(4, 9_100)]) {
      expect(campaign.videoSource).toStrictEqual({
        kind: "hls",
        manifestUrl: MOCK_HLS_MANIFEST_URL,
      });
    }
  });
});
