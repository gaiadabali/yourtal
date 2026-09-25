import type { QuestionDraft } from "./question-draft";

/**
 * Maps a completed authoring draft onto the exact field shape
 * `@yourtal/contracts/question`'s `questionSchema` expects — the "one
 * schema drives everything" seam docs/13b-typescript-standards.md §3 asks
 * for, without this (client-reachable) module ever importing that schema as
 * a value. `question-draft-to-question.test.ts` is where the real
 * `questionSchema.safeParse` round-trips this function's output — tests are
 * not bundled, so a value import there costs nothing in production.
 *
 * Returns `null` when the draft is not yet complete enough to publish (a
 * scored type with no correct answer marked, or fewer than two non-empty
 * options/items) — never throws, since "not finished yet" is the normal
 * state of a draft mid-authoring, not a programmer error.
 */
export function toPublishableQuestionInput(draft: QuestionDraft): Record<string, unknown> | null {
  if (draft.prompt.trim().length === 0) {
    return null;
  }
  const shared = {
    id: draft.id,
    campaignId: draft.campaignId,
    prompt: draft.prompt,
    timerSeconds: draft.timerSeconds,
    // Not yet authorable in the studio draft (TASKS.md 1.1.f added the
    // column; a per-question timing control in the question-bank editor is
    // studio UI work, not this task's). 0 keeps every existing question
    // askable from the start, the same default the F10 migration backfilled
    // onto rows written before this field existed.
    answerableAfterSeconds: 0,
  };

  switch (draft.type) {
    case "multiple_choice": {
      const options = draft.options.filter((option) => option.label.trim().length > 0);
      if (options.length < 2 || !draft.correctOptionId) {
        return null;
      }
      return { ...shared, type: draft.type, options, correctOptionId: draft.correctOptionId };
    }
    case "true_false": {
      if (draft.correctAnswer === null) {
        return null;
      }
      return { ...shared, type: draft.type, correctAnswer: draft.correctAnswer };
    }
    case "likert": {
      if (draft.scaleLowLabel.trim().length === 0 || draft.scaleHighLabel.trim().length === 0) {
        return null;
      }
      return {
        ...shared,
        type: draft.type,
        scaleMin: draft.scaleMin,
        scaleMax: draft.scaleMax,
        scaleLowLabel: draft.scaleLowLabel,
        scaleHighLabel: draft.scaleHighLabel,
      };
    }
    case "ranked": {
      const items = draft.items.filter((item) => item.label.trim().length > 0);
      if (items.length < 2) {
        return null;
      }
      return { ...shared, type: draft.type, items };
    }
    case "short_text": {
      return { ...shared, type: draft.type, maxLength: draft.maxLength };
    }
    default: {
      const exhaustive: never = draft;
      throw new Error(`Unhandled question draft type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
