import { describe, expect, it } from "vitest";
import type { CampaignDraft } from "./campaign-draft";
import { liveApiDraft, liveDraft } from "./campaign-draft-live-fixtures";
import { submitGapsFromRefusal, submitReadiness } from "./campaign-submit-readiness";

/** A 20-second video, processed, with a saved reward and budget: asks no questions, so none are needed. */
function readyDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    ...liveDraft({
      title: "Two for one",
      synopsis: "Two coffees for one, all week.",
      durationSeconds: 20,
      hlsUrl: "https://media.test/index.m3u8",
      rewardPoints: 2,
      rewardConfig: {
        allocationId: "alloc-1",
        rewardPointsPerCompletion: 2,
        accuracyBonusPoints: 0,
        maxPointsForCampaign: 100,
        dailyCapPoints: null,
      },
    }),
    ...overrides,
  };
}

describe("submitReadiness (B6, B7: say what is missing before asking)", () => {
  it("is ready when title, synopsis, video, reward and budget are in and no questions are needed", () => {
    expect(submitReadiness(readyDraft()).gaps).toEqual([]);
  });

  it("lists everything a brand new draft lacks, each once", () => {
    const fresh = liveDraft();
    expect(submitReadiness(fresh)).toEqual({
      gaps: ["synopsis", "videoMissing", "reward", "questions"],
      // The placeholder minute asks one question, so three are needed (F10, 3x).
      questionsNeeded: 3,
      questionsHave: 0,
    });
  });

  it("says the video is still processing, not missing, while it uploads or processes", () => {
    for (const status of ["uploading", "processing"] as const) {
      const draft = readyDraft({ video: { fileName: "a.mp4", status, progressPercent: 100 } });
      expect(submitReadiness(draft).gaps).toEqual(["videoProcessing"]);
    }
  });

  it("asks for a saved reward when changes are only on screen", () => {
    expect(submitReadiness(readyDraft({ rewardPoints: 5 })).gaps).toEqual(["rewardUnsaved"]);
    expect(submitReadiness(readyDraft({ allocationId: "alloc-2" })).gaps).toEqual([
      "rewardUnsaved",
    ]);
  });

  it("asks for a budget that covers one viewer's reward", () => {
    const draft = readyDraft({
      savedReward: {
        rewardPoints: 2,
        accuracyBonusPoints: 0,
        allocationId: "alloc-1",
        totalBudgetPoints: 0,
        dailyCapPoints: null,
      },
      budget: { totalBudgetPoints: 0, dailyCapPoints: null },
    });
    expect(submitReadiness(draft).gaps).toEqual(["budget"]);
  });

  it("counts the questions the video's real length needs", () => {
    const draft = readyDraft({
      durationSeconds: 90,
      video: { fileName: null, status: "ready", progressPercent: 100 },
    });
    expect(submitReadiness(draft)).toMatchObject({
      gaps: ["questions"],
      questionsNeeded: 3,
      questionsHave: 0,
    });
  });
});

describe("submitGapsFromRefusal", () => {
  it("reads the API's own list, so a gap the screen missed is still named", () => {
    expect(
      submitGapsFromRefusal({
        code: "campaign_not_ready",
        details: {
          missing: ["video", "questions", "unknown"],
          questionsNeeded: 3,
          questionsHave: 1,
        },
      }),
    ).toEqual({ gaps: ["videoMissing", "questions"], questionsNeeded: 3, questionsHave: 1 });
  });

  it("is null for any other refusal", () => {
    expect(submitGapsFromRefusal({ code: "creative_blocked" })).toBeNull();
    expect(submitGapsFromRefusal({ code: "campaign_not_ready" })).toBeNull();
  });

  it("keeps the fixtures honest: a fresh API draft really has a placeholder minute", () => {
    expect(liveApiDraft().durationSeconds).toBe(60);
  });
});
