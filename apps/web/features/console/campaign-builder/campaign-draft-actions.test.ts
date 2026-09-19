import { describe, expect, it } from "vitest";
import { createChapter } from "./campaign-chapter";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import {
  campaignDraftActionErrorMessage,
  pauseCampaign,
  resumeCampaign,
  reviseRejectedDraft,
  submitForReview,
} from "./campaign-draft-actions";
import { createEmptyQuestionDraft } from "../question-bank/question-draft";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";

function readyDraftWithBank() {
  const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
  draft.title = "Launch video";
  draft.chapters = [createChapter("Intro", 0), createChapter("Close", 300)]; // 330s -> asks 1, needs 3
  draft.video = { fileName: "launch.mp4", status: "ready", progressPercent: 100 };
  draft.questionBank = Array.from({ length: 3 }, (_unused, index) => {
    const question = createEmptyQuestionDraft("true_false", draft.id);
    question.prompt = `Comprehension question ${index}`;
    question.correctAnswer = true;
    return question;
  });
  return draft;
}

describe("submitForReview", () => {
  it("refuses a draft with no title", () => {
    const draft = readyDraftWithBank();
    draft.title = "";
    const result = submitForReview(draft);
    expect(result.ok).toBe(false);
  });

  it("refuses a draft whose video is not ready", () => {
    const draft = readyDraftWithBank();
    draft.video = { fileName: null, status: "idle", progressPercent: 0 };
    const result = submitForReview(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("no_video");
    }
  });

  it("refuses a draft whose bank is below the 3x anti-sharing minimum, naming the shortfall", () => {
    const draft = readyDraftWithBank();
    draft.questionBank = draft.questionBank.slice(0, 1); // only 1, needs 3
    const result = submitForReview(draft);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === "bank_too_small") {
      expect(result.error.required).toBe(3);
      expect(result.error.actual).toBe(1);
      expect(campaignDraftActionErrorMessage(result.error)).toContain("at least 3");
    }
  });

  it("accepts a complete, ready draft and moves it to in_review", () => {
    const draft = readyDraftWithBank();
    const result = submitForReview(draft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("in_review");
    }
  });

  it("refuses a draft that is not in draft or rejected status", () => {
    const draft = readyDraftWithBank();
    draft.status = "live";
    const result = submitForReview(draft);
    expect(result.ok).toBe(false);
  });
});

describe("pauseCampaign / resumeCampaign", () => {
  it("pauses a live campaign", () => {
    const draft = { ...readyDraftWithBank(), status: "live" as const };
    const result = pauseCampaign(draft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("paused");
    }
  });

  it("refuses to pause a draft that is not live", () => {
    const result = pauseCampaign(readyDraftWithBank());
    expect(result.ok).toBe(false);
  });

  it("resumes a paused campaign back to live", () => {
    const draft = { ...readyDraftWithBank(), status: "paused" as const };
    const result = resumeCampaign(draft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("live");
    }
  });
});

describe("reviseRejectedDraft", () => {
  it("moves a rejected campaign back to draft, clearing nothing else", () => {
    const draft = {
      ...readyDraftWithBank(),
      status: "rejected" as const,
      rejectionReason: "Too little reward for the length.",
    };
    const result = reviseRejectedDraft(draft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("draft");
    }
  });

  it("refuses on a campaign that was never rejected", () => {
    const result = reviseRejectedDraft(readyDraftWithBank());
    expect(result.ok).toBe(false);
  });
});
