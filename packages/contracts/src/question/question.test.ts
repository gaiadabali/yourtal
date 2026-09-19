import { describe, expect, it } from "vitest";
import { questionSchema } from "./question";
import { generateQuestion, generateQuestions, mockQuestions, singleShortTextQuestionFixture } from "./question.mock";

const validMultipleChoice = {
  id: "11111111-1111-4111-8111-111111111111",
  campaignId: "22222222-2222-4222-8222-222222222222",
  prompt: "Apa produk utama yang ditampilkan?",
  timerSeconds: 15,
  type: "multiple_choice",
  options: [
    { id: "33333333-3333-4333-8333-333333333333", label: "Kopi susu" },
    { id: "44444444-4444-4444-8444-444444444444", label: "Teh manis" },
  ],
  correctOptionId: "33333333-3333-4333-8333-333333333333",
};

const validTrueFalse = {
  id: "11111111-1111-4111-8111-111111111111",
  campaignId: "22222222-2222-4222-8222-222222222222",
  prompt: "Video ini berdurasi lebih dari 10 menit.",
  timerSeconds: 10,
  type: "true_false",
  correctAnswer: true,
};

const validLikert = {
  id: "11111111-1111-4111-8111-111111111111",
  campaignId: "22222222-2222-4222-8222-222222222222",
  prompt: "Seberapa puas Anda dengan layanan ini?",
  timerSeconds: 20,
  type: "likert",
  scaleMin: 1,
  scaleMax: 5,
  scaleLowLabel: "Sangat tidak puas",
  scaleHighLabel: "Sangat puas",
};

describe("questionSchema", () => {
  it("round-trips a valid multiple-choice question", () => {
    expect(questionSchema.safeParse(validMultipleChoice).success).toBe(true);
  });

  it("round-trips a valid true/false question", () => {
    expect(questionSchema.safeParse(validTrueFalse).success).toBe(true);
  });

  it("round-trips a valid likert question", () => {
    expect(questionSchema.safeParse(validLikert).success).toBe(true);
  });

  const rejectionTable: Array<{ name: string; input: unknown }> = [
    { name: "unknown discriminant type", input: { ...validTrueFalse, type: "essay" } },
    {
      name: "multiple_choice with correctOptionId not among options",
      input: { ...validMultipleChoice, correctOptionId: "99999999-9999-4999-8999-999999999999" },
    },
    { name: "multiple_choice with only one option", input: { ...validMultipleChoice, options: [validMultipleChoice.options[0]] } },
    { name: "likert with scaleMin >= scaleMax", input: { ...validLikert, scaleMin: 5, scaleMax: 5 } },
    { name: "negative timerSeconds", input: { ...validTrueFalse, timerSeconds: -5 } },
    { name: "timerSeconds over the 120s ceiling", input: { ...validTrueFalse, timerSeconds: 999 } },
    { name: "empty prompt", input: { ...validTrueFalse, prompt: "" } },
    { name: "non-boolean correctAnswer", input: { ...validTrueFalse, correctAnswer: "yes" } },
    { name: "missing type discriminant", input: { ...validTrueFalse, type: undefined } },
    { name: "short_text with maxLength over ceiling", input: { id: validTrueFalse.id, campaignId: validTrueFalse.campaignId, prompt: "x", timerSeconds: 10, type: "short_text", maxLength: 9_999 } },
  ];

  it.each(rejectionTable)("rejects $name", ({ input }) => {
    expect(questionSchema.safeParse(input).success).toBe(false);
  });
});

describe("generateQuestion determinism", () => {
  it("produces byte-identical output for the same seed", () => {
    const first = generateQuestion({ seed: 5, campaignId: "22222222-2222-4222-8222-222222222222" });
    const second = generateQuestion({ seed: 5, campaignId: "22222222-2222-4222-8222-222222222222" });
    expect(first).toStrictEqual(second);
  });

  it("generates a batch that is itself deterministic", () => {
    expect(generateQuestions(10, 5_000)).toStrictEqual(mockQuestions);
  });
});

describe("awkward fixtures", () => {
  it("the single short-text question fixture is a valid short_text question", () => {
    expect(singleShortTextQuestionFixture.type).toBe("short_text");
    expect(questionSchema.safeParse(singleShortTextQuestionFixture).success).toBe(true);
  });
});
