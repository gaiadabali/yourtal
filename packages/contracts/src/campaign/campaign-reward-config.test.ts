import { describe, expect, it } from "vitest";
import {
  affordableCompletions,
  campaignRewardConfigSchema,
  exceedsAccuracyBonusRatio,
  exceedsRewardCeiling,
  maxPointsPerViewer,
} from "./campaign-reward-config";

const baseConfig = {
  campaignId: "11111111-1111-4111-8111-111111111111",
  allocationId: "alloc-1",
  funderType: "partner" as const,
  maxPointsForCampaign: 10_000,
  rewardPointsPerCompletion: 100,
  accuracyBonusPoints: 20,
};

describe("campaignRewardConfigSchema", () => {
  it("round-trips a valid config", () => {
    expect(campaignRewardConfigSchema.safeParse(baseConfig).success).toBe(true);
  });

  it("rejects a completion that cannot fit within the campaign ceiling", () => {
    expect(
      campaignRewardConfigSchema.safeParse({ ...baseConfig, maxPointsForCampaign: 50 }).success,
    ).toBe(false);
  });
});

describe("maxPointsPerViewer / affordableCompletions", () => {
  it("sums base and bonus", () => {
    expect(maxPointsPerViewer(baseConfig)).toBe(120);
  });

  it("floors to the tighter of the campaign cap and the allocation", () => {
    expect(affordableCompletions(baseConfig, 1_000)).toBe(8); // floor(1000/120)
    expect(affordableCompletions(baseConfig, 1_000_000)).toBe(83); // floor(10000/120)
  });
});

describe("exceedsRewardCeiling (F14)", () => {
  it("passes a completion within the per-minute ceiling scaled to duration", () => {
    // 20 minutes at an AU-shaped ceiling of 8 pts/min = 160 pts allowed; 120 fits.
    expect(exceedsRewardCeiling(baseConfig, 20 * 60, 8)).toBe(false);
  });

  it("refuses a completion above the ceiling", () => {
    // 5 minutes at 8 pts/min = 40 pts allowed; 120 does not fit.
    expect(exceedsRewardCeiling(baseConfig, 5 * 60, 8)).toBe(true);
  });

  it("counts base plus bonus together, not just the base", () => {
    // 14 minutes at 8 pts/min = 112 pts allowed. Base alone (100) would fit;
    // base+bonus (120) does not.
    expect(exceedsRewardCeiling(baseConfig, 14 * 60, 8)).toBe(true);
  });
});

describe("exceedsAccuracyBonusRatio (7.3.c: bonus <= 40% of base)", () => {
  it("allows a bonus at exactly 40%", () => {
    expect(exceedsAccuracyBonusRatio({ rewardPointsPerCompletion: 100, accuracyBonusPoints: 40 })).toBe(
      false,
    );
  });

  it("refuses a bonus above 40%", () => {
    expect(exceedsAccuracyBonusRatio({ rewardPointsPerCompletion: 100, accuracyBonusPoints: 41 })).toBe(
      true,
    );
  });
});
