import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import type { QuestionDraft } from "./question-draft";
import { toPublishableQuestionInput } from "./question-draft-to-question";
import { QUESTION_TYPE_LABELS, questionTypeScoreLabel } from "./question-type-catalog";

export interface QuestionListRowProps {
  draft: QuestionDraft;
  onEdit: () => void;
  onRemove: () => void;
}

/** One row in the bank list: prompt preview, type and scored/opinion badges, completeness, edit/remove. No local state — rendered inside `question-bank-screen.tsx`'s already-client tree. */
export function QuestionListRow({ draft, onEdit, onRemove }: QuestionListRowProps) {
  const isComplete = toPublishableQuestionInput(draft) !== null;

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-sans text-fg">
          {draft.prompt.trim() || "(no prompt yet)"}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{QUESTION_TYPE_LABELS[draft.type]}</Badge>
          <Badge variant="outline">{questionTypeScoreLabel(draft.type)}</Badge>
          {!isComplete ? <Badge variant="warning">Incomplete</Badge> : null}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </li>
  );
}
