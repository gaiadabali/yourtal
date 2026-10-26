import { describe, expect, it } from "vitest";
import { toPoints } from "../money/money";
import {
  affordableCompletions,
  campaignBudgetRefusal,
  campaignRewardConfigSchema,
  exceedsAccuracyBonusRatio,
  exceedsRewardCeiling,
  maxPointsPerViewer,
  maxRewardPointsFor,
} from "./campaign-reward-config";

const baseConfig = {
  campaignId: "11111111-1111-4111-8111-111111111111",
  allocationId: "alloc-1",
  funderType: "partner" as const,
  maxPointsForCampaign: toPoints(10_000),
  rewardPointsPerCompletion: toPoints(100),
  accuracyBonusPoints: toPoints(20),
  dailyCapPoints: null,
};

describe("campaignRewardConfigSchema", () => {
  it("round-trips a valid config", () => {
    expect(campaignRewardConfigSchema.safeParse(baseConfig).success).toBe(true);
  });

  it("rejects a completion that cannot fit within the campaign ceiling", () => {
    expect(
      campaignRewardConfigSchema.safeParse({ ...baseConfig, maxPointsForCampaign: toPoints(50) })
        .success,
    ).toBe(false);
  });
});

describe("campaignBudgetRefusal (14.2)", () => {
  it("accepts no daily cap, and a cap between one completion and the budget", () => {
    expect(campaignBudgetRefusal(baseConfig)).toBeNull();
    expect(campaignBudgetRefusal({ ...baseConfig, dailyCapPoints: toPoints(120) })).toBeNull();
    expect(campaignBudgetRefusal({ ...baseConfig, dailyCapPoints: toPoints(10_000) })).toBeNull();
  });

  it("refuses a budget or a cap that could never pay one completion", () => {
    expect(campaignBudgetRefusal({ ...baseConfig, maxPointsForCampaign: toPoints(119) })).toBe(
      "budget_below_one_completion",
    );
    expect(campaignBudgetRefusal({ ...baseConfig, dailyCapPoints: toPoints(119) })).toBe(
      "daily_cap_below_one_completion",
    );
  });

  it("refuses a daily cap above the total budget", () => {
    expect(campaignBudgetRefusal({ ...baseConfig, dailyCapPoints: toPoints(10_001) })).toBe(
      "daily_cap_above_budget",
    );
    expect(
      campaignRewardConfigSchema.safeParse({ ...baseConfig, dailyCapPoints: toPoints(10_001) })
        .success,
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
    expect(
      exceedsAccuracyBonusRatio({
        rewardPointsPerCompletion: toPoints(100),
        accuracyBonusPoints: toPoints(40),
      }),
    ).toBe(false);
  });

  it("refuses a bonus above 40%", () => {
    expect(
      exceedsAccuracyBonusRatio({
        rewardPointsPerCompletion: toPoints(100),
        accuracyBonusPoints: toPoints(41),
      }),
    ).toBe(true);
  });
});

describe("maxRewardPointsFor (F14 limit in whole points)", () => {
  it("scales the per-minute ceiling to the duration and rounds down", () => {
    // AU: 8 points a minute. A 20-second video may pay 2 points (2.67 rounded down), not 8.
    expect(maxRewardPointsFor(20, 8)).toBe(2);
    expect(maxRewardPointsFor(60, 8)).toBe(8);
    expect(maxRewardPointsFor(90, 8)).toBe(12);
    expect(maxRewardPointsFor(5, 8)).toBe(0);
  });

  it("agrees with exceedsRewardCeiling for every whole total", () => {
    for (const seconds of [7, 20, 45, 60, 150]) {
      const limit = maxRewardPointsFor(seconds, 8);
      const at = (total: number) =>
        exceedsRewardCeiling(
          { rewardPointsPerCompletion: toPoints(total), accuracyBonusPoints: toPoints(0) },
          seconds,
          8,
        );
      expect(at(limit)).toBe(false);
      expect(at(limit + 1)).toBe(true);
    }
  });
});
