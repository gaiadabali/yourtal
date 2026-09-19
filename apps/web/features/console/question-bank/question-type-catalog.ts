import type { QuestionDraftType } from "./question-draft";
import { QUESTION_TYPES, isScoredQuestionType } from "./question-draft";

export { QUESTION_TYPES };

/** Copy for the type picker and bank list, table-driven from docs/06 §4.1's "Authoring" table so wording stays traceable to the doc it comes from. */
export const QUESTION_TYPE_LABELS: Record<QuestionDraftType, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / false",
  likert: "Rating (Likert)",
  ranked: "Ranked preference",
  short_text: "Short free text",
};

export const QUESTION_TYPE_DESCRIPTIONS: Record<QuestionDraftType, string> = {
  multiple_choice: "Recall of a fact or claim from the video. Scored against one correct answer.",
  true_false: "Quick comprehension check. Scored against one correct answer.",
  likert:
    "Brand sentiment or purchase intent on a rating scale. Opinion — never scored for correctness.",
  ranked:
    "Feature or product preference, ranked by the viewer. Opinion — never scored for correctness.",
  short_text:
    "Optional open feedback, capped in length. Never scored — sampled for reporting only.",
};

export function questionTypeScoreLabel(type: QuestionDraftType): "Scored" | "Opinion" {
  return isScoredQuestionType(type) ? "Scored" : "Opinion";
}
