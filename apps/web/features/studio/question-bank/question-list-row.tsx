import { useTranslations } from "next-intl";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import type { QuestionDraft } from "./question-draft";
import { toPublishableQuestionInput } from "./question-draft-to-question";
import { questionTypeLabel, questionTypeScoreLabel } from "./question-type-catalog";

export interface QuestionListRowProps {
  draft: QuestionDraft;
  /** Optional so a future read-only rendering can omit it outright rather than merely disable it; `question-bank-screen.tsx` currently always passes both, live mode included since 7.3.i. */
  onEdit?: () => void;
  onRemove?: () => void;
}

/** One row in the bank list: prompt preview, type and scored/opinion badges, completeness, edit/remove. No local state — rendered inside `question-bank-screen.tsx`'s already-client tree. */
export function QuestionListRow({ draft, onEdit, onRemove }: QuestionListRowProps) {
  const t = useTranslations("studio");
  const isComplete = toPublishableQuestionInput(draft) !== null;

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-sans text-fg">
          {draft.prompt.trim() || t("questionBank.noPromptYet")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{questionTypeLabel(t, draft.type)}</Badge>
          <Badge variant="outline">{questionTypeScoreLabel(t, draft.type)}</Badge>
          {!isComplete ? <Badge variant="warning">{t("questionBank.incomplete")}</Badge> : null}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        {onEdit ? (
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            {t("questionBank.edit")}
          </Button>
        ) : null}
        {onRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {t("questionBank.remove")}
          </Button>
        ) : null}
        {!onEdit && !onRemove ? (
          <span className="text-xs font-sans text-fg-subtle">{t("questionBank.saved")}</span>
        ) : null}
      </div>
    </li>
  );
}
