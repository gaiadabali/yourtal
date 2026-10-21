import { describe, expect, it } from "vitest";
import { apiDraftToWebDraft } from "./campaign-draft-live-mapping";
import type { ApiCampaignDraft } from "./campaign-draft-live-response";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import { draftBudgetIssue, rewardConfigPatchFor, rewardErrorText } from "./campaign-reward-patch";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000602";

function draftWith(budget: { totalBudgetPoints: number; dailyCapPoints: number | null }) {
  const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
  return { ...draft, rewardPoints: 100, accuracyBonusPoints: 20, budget };
}

describe("draftBudgetIssue (14.2)", () => {
  it("accepts no cap, and a cap between one completion and the budget", () => {
    expect(draftBudgetIssue(draftWith({ totalBudgetPoints: 1_000, dailyCapPoints: null }))).toBe(
      null,
    );
    expect(draftBudgetIssue(draftWith({ totalBudgetPoints: 1_000, dailyCapPoints: 120 }))).toBe(
      null,
    );
  });

  it("names the rule a budget breaks", () => {
    expect(draftBudgetIssue(draftWith({ totalBudgetPoints: 119, dailyCapPoints: null }))).toBe(
      "budgetBelowOneCompletion",
    );
    expect(draftBudgetIssue(draftWith({ totalBudgetPoints: 1_000, dailyCapPoints: 119 }))).toBe(
      "dailyCapBelowOneCompletion",
    );
    expect(draftBudgetIssue(draftWith({ totalBudgetPoints: 1_000, dailyCapPoints: 1_001 }))).toBe(
      "dailyCapAboveBudget",
    );
  });
});

describe("rewardConfigPatchFor (14.2)", () => {
  it("sends the budget and daily cap with the reward", () => {
    const draft = {
      ...draftWith({ totalBudgetPoints: 5_000, dailyCapPoints: 600 }),
      allocationId: "alloc-1",
    };
    expect(rewardConfigPatchFor(draft)).toEqual({
      allocationId: "alloc-1",
      rewardPointsPerCompletion: 100,
      accuracyBonusPoints: 20,
      maxPointsForCampaign: 5_000,
      dailyCapPoints: 600,
    });
  });

  it("is null until the funding is chosen", () => {
    expect(
      rewardConfigPatchFor(draftWith({ totalBudgetPoints: 5_000, dailyCapPoints: null })),
    ).toBe(null);
  });
});

describe("apiDraftToWebDraft (14.2)", () => {
  it("shows the saved districts, budget, daily cap and funding when a campaign is reopened", () => {
    const api = {
      id: "11111111-1111-4111-8111-111111111111",
      businessId: BUSINESS_ID,
      region: "AU",
      kind: "long_form",
      title: "t",
      synopsis: "s",
      durationSeconds: 600,
      contentCategory: "food-and-drink",
      audience: "all_ages",
      lifecycleState: "draft",
      rejectionReason: null,
      startsAt: "2026-10-20T00:00:00.000Z",
      endsAt: "2026-11-20T00:00:00.000Z",
      openViewing: false,
      teaserStartSeconds: 0,
      posterFrameSeconds: null,
      declaredInterests: [],
      chapters: [],
      captionsUrl: null,
      posterUrl: null,
      teaserUrl: null,
      hlsUrl: null,
      rewardPoints: 100,
      questionCount: 3,
      scoringRule: "base_plus_accuracy_bonus",
      publishedAt: null,
      targetDistricts: ["Bondi"],
      rewardConfig: {
        allocationId: "alloc-1",
        rewardPointsPerCompletion: 100,
        accuracyBonusPoints: 20,
        maxPointsForCampaign: 5_000,
        dailyCapPoints: 600,
      },
    } satisfies ApiCampaignDraft;
    const draft = apiDraftToWebDraft(api, "Kopi Kenangan");
    expect(draft.targeting.districts).toEqual(["Bondi"]);
    expect(draft.budget).toEqual({ totalBudgetPoints: 5_000, dailyCapPoints: 600 });
    expect(draft.allocationId).toBe("alloc-1");
    expect(draft.accuracyBonusPoints).toBe(20);
  });
});

describe("rewardErrorText (2.10.b, F127)", () => {
  const t = () => "That funding is a receipt package.";
  it("words a receipt package refusal from the catalogue, not the server's id-bearing message", () => {
    expect(
      rewardErrorText(
        { message: "allocation abc is a receipt package", code: "allocation_not_campaign_funding" },
        t,
      ),
    ).toBe("That funding is a receipt package.");
  });
  it("keeps the server's message for any other refusal", () => {
    expect(rewardErrorText({ message: "reward too high", code: "reward_exceeds_ceiling" }, t)).toBe(
      "reward too high",
    );
    expect(rewardErrorText({ message: "network error" }, t)).toBe("network error");
  });
});
