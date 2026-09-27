import type { useTranslations } from "next-intl";
import type { QuestionDraftType } from "./question-draft";
import { QUESTION_TYPES, isScoredQuestionType } from "./question-draft";

export { QUESTION_TYPES };

type StudioTranslator = ReturnType<typeof useTranslations>;

/** Copy for the type picker and bank list, table-driven from docs/06 §4.1's "Authoring" table so wording stays traceable to the doc it comes from. */
export function questionTypeLabel(t: StudioTranslator, type: QuestionDraftType): string {
  return t(`questionBank.type.${type}.label`);
}

export function questionTypeDescription(t: StudioTranslator, type: QuestionDraftType): string {
  return t(`questionBank.type.${type}.description`);
}

export function questionTypeScoreLabel(t: StudioTranslator, type: QuestionDraftType): string {
  return isScoredQuestionType(type)
    ? t("questionBank.type.scored")
    : t("questionBank.type.opinion");
}
