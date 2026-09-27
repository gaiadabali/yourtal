import { describe, expect, it } from "vitest";
import { createChapter } from "./campaign-chapter";
import {
  draftCompleteQuestionCount,
  draftDurationSeconds,
  draftEstimatedDataMb,
  draftFormValues,
  validateCampaignDraftForm,
} from "./campaign-draft";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import { createEmptyQuestionDraft } from "../question-bank/question-draft";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";

describe("draftDurationSeconds / draftEstimatedDataMb", () => {
  it("derive from chapters, never a separately-entered field", () => {
    const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
    draft.chapters = [createChapter("Intro", 0), createChapter("Close", 570)]; // 600s total
    expect(draftDurationSeconds(draft)).toBe(600);
    expect(draftEstimatedDataMb(draft)).toBe(60);
  });
});

describe("draftCompleteQuestionCount", () => {
  it("counts only complete questions, not empty in-progress drafts", () => {
    const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
    const complete = createEmptyQuestionDraft("true_false", draft.id);
    complete.prompt = "Is this true?";
    complete.correctAnswer = true;
    const incomplete = createEmptyQuestionDraft("true_false", draft.id);
    incomplete.prompt = "Unanswered so far";
    draft.questionBank = [complete, incomplete];
    expect(draftCompleteQuestionCount(draft)).toBe(1);
  });
});

describe("validateCampaignDraftForm", () => {
  it("flags an empty title and synopsis with distinct messages", () => {
    const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
    const errors = validateCampaignDraftForm(draftFormValues(draft));
    expect(errors.title).toBeDefined();
    expect(errors.synopsis).toBeDefined();
  });

  it("flags a zero total budget", () => {
    const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
    draft.title = "Launch";
    draft.synopsis = "A short synopsis.";
    const errors = validateCampaignDraftForm(draftFormValues(draft));
    expect(errors.totalBudgetPoints).toBeDefined();
  });

  it("flags a negative reward instead of silently accepting it", () => {
    const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
    draft.title = "Launch";
    draft.synopsis = "A short synopsis.";
    draft.rewardPoints = -50;
    draft.budget = { totalBudgetPoints: 100_000, dailyCapPoints: null };
    const errors = validateCampaignDraftForm(draftFormValues(draft));
    expect(errors.rewardPoints).toBeDefined();
  });

  it("returns no errors for a fully valid draft", () => {
    const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
    draft.title = "Launch";
    draft.synopsis = "A short synopsis.";
    draft.rewardPoints = 500;
    draft.budget = { totalBudgetPoints: 100_000, dailyCapPoints: null };
    expect(validateCampaignDraftForm(draftFormValues(draft))).toStrictEqual({});
  });
});
