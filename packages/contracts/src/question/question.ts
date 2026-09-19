import { z } from "zod";

/**
 * Checkpoint questions (docs/tasks/phase-u-ui.md YT-0413): five distinct
 * shapes, modelled as a discriminated union on `type` so a screen's
 * `switch` over question type is exhaustive at compile time
 * (docs/13b-typescript-standards.md section 4's exhaustiveness discipline
 * applies here too, even though this isn't a `neverthrow` error union).
 */
export const questionOptionSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1).max(200),
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

const MAX_TIMER_SECONDS = 120;
const MAX_PROMPT_LENGTH = 300;

const baseQuestionShape = {
  id: z.uuid(),
  campaignId: z.uuid(),
  prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
  timerSeconds: z.number().int().positive().max(MAX_TIMER_SECONDS),
};

const multipleChoiceQuestionSchema = z
  .object({
    ...baseQuestionShape,
    type: z.literal("multiple_choice"),
    options: z.array(questionOptionSchema).min(2).max(6),
    correctOptionId: z.uuid(),
  })
  .refine((question) => question.options.some((option) => option.id === question.correctOptionId), {
    message: "correctOptionId must reference one of the provided options",
    path: ["correctOptionId"],
  });

const trueFalseQuestionSchema = z.object({
  ...baseQuestionShape,
  type: z.literal("true_false"),
  correctAnswer: z.boolean(),
});

const likertQuestionSchema = z
  .object({
    ...baseQuestionShape,
    type: z.literal("likert"),
    scaleMin: z.number().int(),
    scaleMax: z.number().int(),
    scaleLowLabel: z.string().min(1).max(60),
    scaleHighLabel: z.string().min(1).max(60),
  })
  .refine((question) => question.scaleMin < question.scaleMax, {
    message: "scaleMin must be less than scaleMax",
    path: ["scaleMax"],
  });

const rankedQuestionSchema = z.object({
  ...baseQuestionShape,
  type: z.literal("ranked"),
  items: z.array(questionOptionSchema).min(2).max(6),
});

const shortTextQuestionSchema = z.object({
  ...baseQuestionShape,
  type: z.literal("short_text"),
  maxLength: z.number().int().positive().max(500),
});

export const questionSchema = z.discriminatedUnion("type", [
  multipleChoiceQuestionSchema,
  trueFalseQuestionSchema,
  likertQuestionSchema,
  rankedQuestionSchema,
  shortTextQuestionSchema,
]);

export type Question = z.infer<typeof questionSchema>;
export type MultipleChoiceQuestion = z.infer<typeof multipleChoiceQuestionSchema>;
export type TrueFalseQuestion = z.infer<typeof trueFalseQuestionSchema>;
export type LikertQuestion = z.infer<typeof likertQuestionSchema>;
export type RankedQuestion = z.infer<typeof rankedQuestionSchema>;
export type ShortTextQuestion = z.infer<typeof shortTextQuestionSchema>;
