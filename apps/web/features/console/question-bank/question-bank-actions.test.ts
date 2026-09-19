import { describe, expect, it } from "vitest";
import { createEmptyQuestionDraft } from "./question-draft";
import {
  addQuestionToBank,
  questionBankActionErrorMessage,
  removeQuestionFromBank,
  updateQuestionInBank,
} from "./question-bank-actions";

const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000900";
let counter = 0;
const idFactory = () => {
  counter += 1;
  return `id-${counter}`;
};

describe("addQuestionToBank", () => {
  it("adds a question with a clean prompt", () => {
    const draft = createEmptyQuestionDraft("short_text", CAMPAIGN_ID, idFactory);
    draft.prompt = "Any feedback on the video?";
    const result = addQuestionToBank([], draft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
    }
  });

  it("refuses an empty prompt", () => {
    const draft = createEmptyQuestionDraft("short_text", CAMPAIGN_ID, idFactory);
    const result = addQuestionToBank([], draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("empty_prompt");
    }
  });

  it("refuses a PII-harvesting prompt even if the caller bypasses the inline warning", () => {
    const draft = createEmptyQuestionDraft("short_text", CAMPAIGN_ID, idFactory);
    draft.prompt = "What is your phone number?";
    const result = addQuestionToBank([], draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("pii_request");
      expect(questionBankActionErrorMessage(result.error).length).toBeGreaterThan(0);
    }
  });
});

describe("updateQuestionInBank", () => {
  it("updates an existing question in place", () => {
    const draft = createEmptyQuestionDraft("short_text", CAMPAIGN_ID, idFactory);
    draft.prompt = "Original prompt";
    const updated = { ...draft, prompt: "Updated prompt" };
    const result = updateQuestionInBank([draft], updated);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.prompt).toBe("Updated prompt");
    }
  });

  it("refuses to update a question that is not in the bank", () => {
    const draft = createEmptyQuestionDraft("short_text", CAMPAIGN_ID, idFactory);
    draft.prompt = "Some prompt";
    const result = updateQuestionInBank([], draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("not_found");
    }
  });
});

describe("removeQuestionFromBank", () => {
  it("removes a question by id", () => {
    const draft = createEmptyQuestionDraft("short_text", CAMPAIGN_ID, idFactory);
    const result = removeQuestionFromBank([draft], draft.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it("refuses to remove a question that does not exist", () => {
    const result = removeQuestionFromBank([], "missing-id");
    expect(result.ok).toBe(false);
  });
});
