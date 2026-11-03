import { describe, expect, it } from "vitest";
import type { Question } from "@yourtal/contracts/question";
import type { CampaignDraft } from "../persistence/campaign-draft.repository";
import type { BankQuestionRecord } from "../persistence/question-bank.repository";
import { campaignReadiness, describeReadiness, usableQuestionCount } from "./campaign-readiness";

/** A draft that has everything review needs, for a 20-second video (asks no questions). */
const READY: CampaignDraft = {
  id: "campaign-1",
  businessId: "business-1",
  region: "AU",
  kind: "long_form",
  title: "Two for one",
  synopsis: "Two coffees for one, all week.",
  durationSeconds: 20,
  contentCategory: "food-and-drink",
  audience: "all_ages",
  lifecycleState: "draft",
  rejectionReason: null,
  startsAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 86_400_000).toISOString(),
  openViewing: false,
  teaserStartSeconds: 0,
  posterFrameSeconds: null,
  declaredInterests: [],
  chapters: [],
  captionsUrl: null,
  posterUrl: "https://media.test/poster.jpg",
  teaserUrl: "https://media.test/teaser.mp4",
  hlsUrl: "https://media.test/index.m3u8",
  rewardPoints: 2,
  questionCount: 0,
  scoringRule: "base_only",
  publishedAt: null,
  targetDistricts: [],
  rewardConfig: {
    allocationId: "alloc-1",
    rewardPointsPerCompletion: 2,
    accuracyBonusPoints: 0,
    maxPointsForCampaign: 100,
    dailyCapPoints: null,
  },
};

function question(overrides: Partial<BankQuestionRecord> = {}): BankQuestionRecord {
  return {
    question: { id: "q" } as unknown as Question,
    status: "draft",
    piiScreen: "clear",
    timesAsked: 0,
    timesCorrect: 0,
    retiredReason: null,
    ...overrides,
  };
}

describe("campaignReadiness (B6, B7: what review needs)", () => {
  it("has no gaps for a complete draft whose video asks no questions", () => {
    expect(campaignReadiness(READY, []).gaps).toEqual([]);
  });

  it("names every gap of a fresh draft, once each", () => {
    const fresh: CampaignDraft = {
      ...READY,
      synopsis: "",
      durationSeconds: 60,
      posterUrl: null,
      teaserUrl: null,
      hlsUrl: null,
      rewardPoints: null,
      rewardConfig: null,
    };
    expect(campaignReadiness(fresh, [])).toEqual({
      gaps: ["synopsis", "video", "reward", "questions"],
      // F10: a minute asks one question, and the bank must be 3x that.
      questionsNeeded: 3,
      questionsHave: 0,
    });
  });

  it("calls the video missing until all three renders exist", () => {
    expect(campaignReadiness({ ...READY, hlsUrl: null }, []).gaps).toEqual(["video"]);
    expect(campaignReadiness({ ...READY, posterUrl: null }, []).gaps).toEqual(["video"]);
  });

  it("treats a blank title or a whitespace-only synopsis as missing", () => {
    expect(campaignReadiness({ ...READY, title: "  ", synopsis: " \n" }, []).gaps).toEqual([
      "title",
      "synopsis",
    ]);
  });

  it("asks for a budget that pays one viewer, when the saved one cannot", () => {
    const short: CampaignDraft = {
      ...READY,
      rewardConfig: { ...READY.rewardConfig!, maxPointsForCampaign: 1 },
    };
    expect(campaignReadiness(short, []).gaps).toEqual(["budget"]);
  });

  it("counts the bank at the video's real length: 3x the questions it asks", () => {
    const ninety = { ...READY, durationSeconds: 90 };
    expect(campaignReadiness(ninety, [question(), question()])).toMatchObject({
      gaps: ["questions"],
      questionsNeeded: 3,
      questionsHave: 2,
    });
    expect(campaignReadiness(ninety, [question(), question(), question()]).gaps).toEqual([]);
  });

  it("does not count a retired question, or one the PII screen refused", () => {
    const bank = [question(), question({ status: "retired" }), question({ piiScreen: "rejected" })];
    expect(usableQuestionCount(bank)).toBe(1);
  });
});

describe("describeReadiness", () => {
  it("says it in plain English, with the question counts", () => {
    const readiness = campaignReadiness(
      { ...READY, durationSeconds: 90, hlsUrl: null, rewardConfig: null, rewardPoints: null },
      [question()],
    );
    expect(describeReadiness(readiness)).toBe(
      "This campaign can't go to review yet. It still needs a video that has finished processing, a saved reward, at least 3 questions (it has 1).",
    );
  });
});
