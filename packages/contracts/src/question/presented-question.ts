import { z } from "zod";
import { questionOptionSchema } from "./question";
import type { Question } from "./question";

/**
 * A question as a viewer sees it. YT-0102.
 *
 * ## The answer key is not stripped here — it is unrepresentable
 *
 * `questionSchema` carries `correctOptionId` and `correctAnswer`. It is the
 * **authoring and scoring** form and it must never reach a client. This type
 * has no field capable of holding an answer, so a leak is a type error
 * rather than a review miss — the same move as `Campaign["status"]` having
 * no value for `draft`.
 *
 * ## Why this matters more than it looks
 *
 * `apps/web/features/checkpoint/checkpoint-scoring.ts` imports `Question`
 * and says in its own header that it runs client-side. So the key currently
 * travels to the browser and the score is computed by the thing being
 * scored. That is harmless while Phase U is mock-only and fatal the moment a
 * real campaign pays points — which is this ticket, because O-1 makes the
 * questions half of the reward gate.
 *
 * It also quietly defeats `docs/18` §11. That section says to assume the key
 * leaks to a Telegram channel and to detect it statistically: population
 * accuracy per question, and a jump from 61% to 97% overnight auto-retires
 * the question. **That control assumes a leak takes effort.** If the key
 * ships with the question there is no channel to find, accuracy sits at 100%
 * from day one, and there is no unknowing population to compare against. The
 * detector needs a population that does not already know the answer.
 *
 * ## Ordering is deliberately not preserved
 *
 * `options` is presented in whatever order the server chose for this viewer
 * (YT-0122 shuffles per user). A stable order across viewers is itself a
 * weak answer key: "it is always the third one" survives a leak of nothing
 * but positions.
 */
const presentedBase = {
  id: z.uuid(),
  campaignId: z.uuid(),
  prompt: z.string().min(1).max(300),
  timerSeconds: z.number().int().positive().max(120),
};

export const presentedQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    ...presentedBase,
    type: z.literal("multiple_choice"),
    options: z.array(questionOptionSchema).min(2).max(6),
  }),
  z.object({ ...presentedBase, type: z.literal("true_false") }),
  z.object({
    ...presentedBase,
    type: z.literal("likert"),
    scaleMin: z.number().int(),
    scaleMax: z.number().int(),
    scaleLowLabel: z.string().min(1).max(60),
    scaleHighLabel: z.string().min(1).max(60),
  }),
  z.object({
    ...presentedBase,
    type: z.literal("ranked"),
    items: z.array(questionOptionSchema).min(2).max(6),
  }),
  z.object({
    ...presentedBase,
    type: z.literal("short_text"),
    maxLength: z.number().int().positive().max(500),
  }),
]);

export type PresentedQuestion = z.infer<typeof presentedQuestionSchema>;

/**
 * The only bridge from the scoring form to the viewer's form.
 *
 * One function rather than a mapper per call site, so "does anything send
 * the key?" is a question with one place to look. `presented-question.test.ts`
 * asserts the output of this function carries no answer field for any of the
 * five types — including the ones where the key is a boolean rather than an
 * id, which is the case a hand-written mapper forgets.
 */
export function toPresentedQuestion(question: Question): PresentedQuestion {
  switch (question.type) {
    case "multiple_choice":
      return {
        id: question.id,
        campaignId: question.campaignId,
        prompt: question.prompt,
        timerSeconds: question.timerSeconds,
        type: "multiple_choice",
        options: question.options,
      };
    case "true_false":
      return {
        id: question.id,
        campaignId: question.campaignId,
        prompt: question.prompt,
        timerSeconds: question.timerSeconds,
        type: "true_false",
      };
    case "likert":
      return {
        id: question.id,
        campaignId: question.campaignId,
        prompt: question.prompt,
        timerSeconds: question.timerSeconds,
        type: "likert",
        scaleMin: question.scaleMin,
        scaleMax: question.scaleMax,
        scaleLowLabel: question.scaleLowLabel,
        scaleHighLabel: question.scaleHighLabel,
      };
    case "ranked":
      return {
        id: question.id,
        campaignId: question.campaignId,
        prompt: question.prompt,
        timerSeconds: question.timerSeconds,
        type: "ranked",
        items: question.items,
      };
    case "short_text":
      return {
        id: question.id,
        campaignId: question.campaignId,
        prompt: question.prompt,
        timerSeconds: question.timerSeconds,
        type: "short_text",
        maxLength: question.maxLength,
      };
  }
}

/**
 * Field names that must never appear in anything sent to a viewer.
 *
 * Exported so the test can assert against the list rather than against three
 * hand-picked examples — a sixth question type with a new kind of key fails
 * the check only if the list is what is compared.
 */
export const ANSWER_KEY_FIELDS = ["correctOptionId", "correctAnswer", "correctOrder"] as const;
