import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUALITY_TIER_ID,
  QUALITY_TIERS,
  buildQualityOptions,
  estimateDataCostMb,
  getQualityTier,
} from "./quality-tier";

describe("quality-tier", () => {
  it("caps the ladder at 720p and never exceeds it (docs/06 §2.3, docs/08 §3.3)", () => {
    expect(QUALITY_TIERS.every((tier) => tier.resolutionHeight <= 720)).toBe(true);
  });

  it("defaults into the 360–480p band the acceptance criteria require", () => {
    const defaultTier = getQualityTier(DEFAULT_QUALITY_TIER_ID);
    expect(defaultTier.resolutionHeight).toBeGreaterThanOrEqual(360);
    expect(defaultTier.resolutionHeight).toBeLessThanOrEqual(480);
  });

  it("reproduces docs/06 §2.3's own worked examples for 480p at 800 kbps", () => {
    // 15 min @ 800 kbps: doc states "~90 MB".
    expect(Math.round(estimateDataCostMb(800, 900))).toBe(88);
    // 30 min @ 800 kbps: doc states "~180 MB".
    expect(Math.round(estimateDataCostMb(800, 1_800))).toBe(176);
  });

  it("computes a distinct MB estimate per option from that option's own bitrate and the given duration — never a flat/generic number", () => {
    const options = buildQualityOptions(900);
    const estimates = options.map((option) => option.estimatedMb);
    expect(new Set(estimates).size).toBe(estimates.length);
    expect(estimates.every((mb) => mb > 0)).toBe(true);

    const doubled = buildQualityOptions(1_800);
    options.forEach((option, index) => {
      expect(doubled[index]?.estimatedMb).toBeCloseTo(option.estimatedMb * 2, 5);
    });
  });

  it("getQualityTier resolves every id QUALITY_TIERS declares (exhaustiveness for the unchecked-throw invariant)", () => {
    for (const tier of QUALITY_TIERS) {
      expect(getQualityTier(tier.id)).toEqual(tier);
    }
  });
});
