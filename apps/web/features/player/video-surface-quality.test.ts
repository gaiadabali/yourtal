import { describe, expect, it } from "vitest";
import {
  MAX_AUTO_HEIGHT,
  VIDEO_SURFACE_QUALITY_TIERS,
  defaultVideoSurfaceQualityId,
  getVideoSurfaceQualityTier,
} from "./video-surface-quality";

describe("video-surface-quality", () => {
  it("never offers a tier above the 720p cap", () => {
    for (const tier of VIDEO_SURFACE_QUALITY_TIERS) {
      expect(tier.resolutionHeight).toBeLessThanOrEqual(MAX_AUTO_HEIGHT);
    }
  });

  it("defaults to 360p on cellular and 540p otherwise", () => {
    expect(defaultVideoSurfaceQualityId(true)).toBe("360p");
    expect(defaultVideoSurfaceQualityId(false)).toBe("540p");
  });

  it("looks up every declared tier by id", () => {
    for (const tier of VIDEO_SURFACE_QUALITY_TIERS) {
      expect(getVideoSurfaceQualityTier(tier.id)).toEqual(tier);
    }
  });
});
