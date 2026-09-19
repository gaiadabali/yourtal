import type { Question } from "@yourtal/contracts/question";

/**
 * One answer shape per question type, mirroring the discriminated union in
 * `@yourtal/contracts/question`. This is UI-local state (what the
 * respondent has entered so far), not a contract — it never crosses a
 * process boundary in this ticket's scope, so it does not belong in
 * `packages/contracts`.
 */
export interface MultipleChoiceAnswer {
  type: "multiple_choice";
  selectedOptionId: string;
}

export interface TrueFalseAnswer {
  type: "true_false";
  value: boolean;
}

export interface LikertAnswer {
  type: "likert";
  value: number;
}

export interface RankedAnswer {
  type: "ranked";
  orderedItemIds: string[];
}

export interface ShortTextAnswer {
  type: "short_text";
  text: string;
}

export type QuestionAnswer =
  MultipleChoiceAnswer | TrueFalseAnswer | LikertAnswer | RankedAnswer | ShortTextAnswer;

/**
 * Whether a question has a usable answer to proceed on. `short_text` is
 * optional per docs/06-longform-video-and-attention.md section 4.1 ("Short
 * free text (optional, capped)"), so it is always proceed-able. `ranked`
 * always has a value once mounted (an unmodified shuffled order is itself
 * a valid ranking). The others need an explicit choice.
 */
export function isAnswerPresent(question: Question, answer: QuestionAnswer | undefined): boolean {
  if (!answer) {
    return question.type === "short_text";
  }
  switch (question.type) {
    case "multiple_choice":
      return answer.type === "multiple_choice" && answer.selectedOptionId.length > 0;
    case "true_false":
      return answer.type === "true_false";
    case "likert":
      return answer.type === "likert";
    case "ranked":
      return answer.type === "ranked" && answer.orderedItemIds.length === question.items.length;
    case "short_text":
      return true;
    default: {
      const exhaustive: never = question;
      return exhaustive;
    }
  }
}
