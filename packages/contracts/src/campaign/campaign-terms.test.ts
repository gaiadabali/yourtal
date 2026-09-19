import { describe, expect, it } from "vitest";
import { toPoints } from "../money/money";
import {
  REWARD_AFFECTING_FIELDS,
  campaignTermsSchema,
  nextTermsVersion,
  requiresNewTermsVersion,
} from "./campaign-terms";
import {
  affordableCompletions,
  campaignRewardConfigSchema,
  maxPointsPerViewer,
} from "./campaign-reward-config";

const CAMPAIGN_ID = "00000000-0000-4000-8000-00000000c001";

const baseTerms = campaignTermsSchema.parse({
  campaignId: CAMPAIGN_ID,
  version: 1,
  rewardPoints: toPoints(2_000),
  questionCount: 3,
  scoringRule: "base_plus_accuracy_bonus",
  durationSeconds: 1_800,
  effectiveFrom: "2026-09-20T00:00:00.000Z",
});

const sameTerms = {
  rewardPoints: toPoints(2_000),
  questionCount: 3,
  scoringRule: "base_plus_accuracy_bonus" as const,
  durationSeconds: 1_800,
};

describe("freezing the terms a viewer entered under", () => {
  it("does not mint a version when nothing a viewer is owed changed", () => {
    expect(requiresNewTermsVersion(baseTerms, sameTerms)).toBe(false);
  });

  it.each(REWARD_AFFECTING_FIELDS)("mints a version when %s changes", (field) => {
    // Table-driven off the exported list, so a field added to the schema
    // without being added to the list fails here rather than silently
    // becoming editable mid-watch.
    const changed = {
      ...sameTerms,
      ...(field === "rewardPoints" ? { rewardPoints: toPoints(500) } : {}),
      ...(field === "questionCount" ? { questionCount: 5 } : {}),
      ...(field === "scoringRule" ? { scoringRule: "base_only" as const } : {}),
      ...(field === "durationSeconds" ? { durationSeconds: 3_600 } : {}),
    };
    expect(requiresNewTermsVersion(baseTerms, changed)).toBe(true);
  });

  it("counts a duration change, because O-1 requires watching the full length", () => {
    // Extending the video after entry changes what a viewer must do to be
    // paid at all — under all-or-nothing there is no partial credit to
    // soften it.
    expect(requiresNewTermsVersion(baseTerms, { ...sameTerms, durationSeconds: 3_600 })).toBe(true);
  });

  it("increments the version and leaves the old one untouched", () => {
    const next = nextTermsVersion(
      baseTerms,
      { ...sameTerms, rewardPoints: toPoints(500) },
      "2026-09-21T00:00:00.000Z",
    );

    expect(next.version).toBe(2);
    expect(next.rewardPoints).toBe(500);
    // The whole point: a viewer who entered under version 1 is still owed
    // 2,000, and that row has not moved.
    expect(baseTerms.version).toBe(1);
    expect(baseTerms.rewardPoints).toBe(2_000);
  });

  it("keeps the campaign id across versions", () => {
    const next = nextTermsVersion(baseTerms, sameTerms, "2026-09-21T00:00:00.000Z");
    expect(next.campaignId).toBe(CAMPAIGN_ID);
  });

  it("rejects a version number that is not positive", () => {
    expect(campaignTermsSchema.safeParse({ ...baseTerms, version: 0 }).success).toBe(false);
  });
});

describe("the reward config", () => {
  const config = campaignRewardConfigSchema.parse({
    campaignId: CAMPAIGN_ID,
    allocationId: "alloc-1",
    funderType: "partner",
    maxPointsForCampaign: toPoints(100_000),
    rewardPointsPerCompletion: toPoints(2_000),
    accuracyBonusPoints: toPoints(500),
  });

  it("sums one viewer's maximum from the base and the bonus only", () => {
    // Under O-1 there is one grant at completion, so there is no
    // per-chapter accrual to add in.
    expect(maxPointsPerViewer(config)).toBe(2_500);
  });

  it("refuses a campaign that pays nothing on completion", () => {
    expect(
      campaignRewardConfigSchema.safeParse({
        ...config,
        rewardPointsPerCompletion: toPoints(0),
      }).success,
    ).toBe(false);
  });

  it("refuses a ceiling too small for a single completion", () => {
    // Otherwise the campaign can never pay anybody, and it is discovered
    // when the first viewer finishes rather than at authoring.
    expect(
      campaignRewardConfigSchema.safeParse({
        ...config,
        maxPointsForCampaign: toPoints(2_000),
      }).success,
    ).toBe(false);
  });

  it("counts affordable completions against whichever limit binds first", () => {
    // The campaign's own ceiling binds: 100,000 / 2,500 = 40.
    expect(affordableCompletions(config, 10_000_000)).toBe(40);
    // The allocation binds: 10,000 / 2,500 = 4.
    expect(affordableCompletions(config, 10_000)).toBe(4);
  });

  it("floors rather than rounding, because a partial completion pays nothing", () => {
    // 6,000 buys two completions at 2,500 and strands 1,000. Rounding up
    // would promise a third the ledger will refuse.
    expect(affordableCompletions(config, 6_000)).toBe(2);
  });

  it("reports zero for an exhausted or negative allocation", () => {
    expect(affordableCompletions(config, 0)).toBe(0);
    expect(affordableCompletions(config, -1)).toBe(0);
  });
});
