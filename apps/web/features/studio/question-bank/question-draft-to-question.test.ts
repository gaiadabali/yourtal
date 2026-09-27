import { describe, expect, it } from "vitest";
// Value import of the REAL contract schema is deliberate and safe here:
// this is a test file, never bundled into a client route
// (docs/13b-typescript-standards.md §8's budget only applies to
// client-reachable code). This is exactly the round-trip test §9 asks
// "packages/contracts" schemas to have, run from the producing side.
import { questionSchema } from "@yourtal/contracts/question";
import { createEmptyQuestionDraft } from "./question-draft";
import { toPublishableQuestionInput } from "./question-draft-to-question";

const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000900";
let counter = 0;
const idFactory = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString().padStart(12, "0")}`;
};

describe("toPublishableQuestionInput", () => {
  it("returns null for an untouched (empty-prompt) draft of every type", () => {
    for (const type of [
      "multiple_choice",
      "true_false",
      "likert",
      "ranked",
      "short_text",
    ] as const) {
      const draft = createEmptyQuestionDraft(type, CAMPAIGN_ID, idFactory);
      expect(toPublishableQuestionInput(draft)).toBeNull();
    }
  });

  it("round-trips a completed multiple_choice draft through the real questionSchema", () => {
    const draft = createEmptyQuestionDraft("multiple_choice", CAMPAIGN_ID, idFactory);
    draft.prompt = "What discount did the video advertise?";
    draft.options[0]!.label = "10%";
    draft.options[1]!.label = "20%";
    draft.correctOptionId = draft.options[1]!.id;

    const input = toPublishableQuestionInput(draft);
    const result = questionSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("refuses to publish multiple_choice with no correct option marked", () => {
    const draft = createEmptyQuestionDraft("multiple_choice", CAMPAIGN_ID, idFactory);
    draft.prompt = "Which colour was the packaging?";
    draft.options[0]!.label = "Red";
    draft.options[1]!.label = "Blue";
    expect(toPublishableQuestionInput(draft)).toBeNull();
  });

  it("round-trips a completed true_false draft", () => {
    const draft = createEmptyQuestionDraft("true_false", CAMPAIGN_ID, idFactory);
    draft.prompt = "The voucher is valid for 30 days.";
    draft.correctAnswer = true;
    const result = questionSchema.safeParse(toPublishableQuestionInput(draft));
    expect(result.success).toBe(true);
  });

  it("round-trips a completed likert draft", () => {
    const draft = createEmptyQuestionDraft("likert", CAMPAIGN_ID, idFactory);
    draft.prompt = "How likely are you to try this product?";
    draft.scaleLowLabel = "Not at all likely";
    draft.scaleHighLabel = "Extremely likely";
    const result = questionSchema.safeParse(toPublishableQuestionInput(draft));
    expect(result.success).toBe(true);
  });

  it("round-trips a completed ranked draft", () => {
    const draft = createEmptyQuestionDraft("ranked", CAMPAIGN_ID, idFactory);
    draft.prompt = "Rank these features by importance to you.";
    draft.items[0]!.label = "Price";
    draft.items[1]!.label = "Quality";
    const result = questionSchema.safeParse(toPublishableQuestionInput(draft));
    expect(result.success).toBe(true);
  });

  it("round-trips a completed short_text draft", () => {
    const draft = createEmptyQuestionDraft("short_text", CAMPAIGN_ID, idFactory);
    draft.prompt = "Any other feedback on the product shown?";
    const result = questionSchema.safeParse(toPublishableQuestionInput(draft));
    expect(result.success).toBe(true);
  });
});
