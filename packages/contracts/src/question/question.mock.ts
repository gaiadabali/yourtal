import type { Question } from "./question";
import { questionSchema } from "./question";
import { createSeededFaker } from "../internal/seeded-faker";

const QUESTION_TYPES = ["multiple_choice", "true_false", "likert", "ranked", "short_text"] as const;

export interface GenerateQuestionParams {
  seed: number;
  campaignId?: string | undefined;
}

/** Generates one deterministic, realistic checkpoint question for the given seed. */
export function generateQuestion(params: GenerateQuestionParams): Question {
  const faker = createSeededFaker(params.seed);
  const campaignId = params.campaignId ?? faker.string.uuid();
  const type = faker.helpers.arrayElement(QUESTION_TYPES);
  const timerSeconds = faker.number.int({ min: 10, max: 30 });

  switch (type) {
    case "multiple_choice": {
      const options = Array.from({ length: faker.number.int({ min: 2, max: 4 }) }, () => ({
        id: faker.string.uuid(),
        label: faker.commerce.productName(),
      }));
      const correctOption = faker.helpers.arrayElement(options);
      return questionSchema.parse({
        id: faker.string.uuid(),
        campaignId,
        prompt: "Apa yang paling sesuai dengan video yang baru saja Anda tonton?",
        timerSeconds,
        type,
        options,
        correctOptionId: correctOption.id,
      });
    }
    case "true_false":
      return questionSchema.parse({
        id: faker.string.uuid(),
        campaignId,
        prompt: "Video ini menjelaskan cara mendapatkan promo secara online.",
        timerSeconds,
        type,
        correctAnswer: faker.datatype.boolean(),
      });
    case "likert":
      return questionSchema.parse({
        id: faker.string.uuid(),
        campaignId,
        prompt: "Seberapa besar kemungkinan Anda merekomendasikan merchant ini ke teman?",
        timerSeconds,
        type,
        scaleMin: 1,
        scaleMax: 5,
        scaleLowLabel: "Sangat tidak mungkin",
        scaleHighLabel: "Sangat mungkin",
      });
    case "ranked": {
      const items = Array.from({ length: faker.number.int({ min: 2, max: 4 }) }, () => ({
        id: faker.string.uuid(),
        label: faker.commerce.productAdjective(),
      }));
      return questionSchema.parse({
        id: faker.string.uuid(),
        campaignId,
        prompt: "Urutkan alasan berikut dari yang paling penting bagi Anda.",
        timerSeconds,
        type,
        items,
      });
    }
    case "short_text":
      return questionSchema.parse({
        id: faker.string.uuid(),
        campaignId,
        prompt: "Sebutkan satu hal yang Anda ingat dari video ini.",
        timerSeconds,
        type,
        maxLength: 140,
      });
  }
}

/** Generates `count` deterministic questions for one campaign, from a base seed. */
export function generateQuestions(
  count: number,
  baseSeed: number,
  campaignId?: string,
): Question[] {
  return Array.from({ length: count }, (_unused, index) =>
    generateQuestion({ seed: baseSeed + index, campaignId }),
  );
}

/** A campaign with a 0-reward-adjacent edge case: a question bank of exactly one short-text item. */
export const singleShortTextQuestionFixture: Question = questionSchema.parse({
  id: "00000000-0000-4000-8000-000000000701",
  campaignId: "00000000-0000-4000-8000-000000000001",
  prompt: "Apa kesan Anda terhadap layanan ini?",
  timerSeconds: 20,
  type: "short_text",
  maxLength: 140,
});

export const mockQuestions: Question[] = generateQuestions(10, 5_000);
