"use client";

import { useState } from "react";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@yourtal/ui/dialog";
import {
  addQuestionToBank,
  questionBankActionErrorMessage,
  removeQuestionFromBank,
  updateQuestionInBank,
} from "./question-bank-actions";
import type { QuestionBankActionError } from "./question-bank-actions";
import { evaluateBankSize } from "./question-bank-rules";
import type { QuestionDraft, QuestionDraftType } from "./question-draft";
import { createEmptyQuestionDraft } from "./question-draft";
import { toPublishableQuestionInput } from "./question-draft-to-question";
import { QuestionEditor } from "./question-editor";
import { QuestionListRow } from "./question-list-row";
import { QuestionTypePicker } from "./question-type-picker";

export interface QuestionBankScreenProps {
  campaignId: string;
  /** The campaign's video length — the bank-size rule scales with it (question-bank-rules.ts). */
  durationSeconds: number;
  initialBank: QuestionDraft[];
  /** Lets the campaign editor keep its own `questionCount`/preview in sync without duplicating this state. */
  onBankChange?: (bank: QuestionDraft[]) => void;
  readOnly?: boolean;
}

type EditorState = { open: false } | { open: true; draft: QuestionDraft; isNew: boolean };

/**
 * A campaign's question bank (YT-0442): the list, an add/edit dialog
 * covering all five types, and the bank-size rule banner — the one client
 * leaf for this whole sub-feature, mounted inside `campaign-editor.tsx`'s
 * "Questions" section.
 */
export function QuestionBankScreen({
  campaignId,
  durationSeconds,
  initialBank,
  onBankChange,
  readOnly = false,
}: QuestionBankScreenProps) {
  const [bank, setBank] = useState<QuestionDraft[]>(initialBank);
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveError, setSaveError] = useState<QuestionBankActionError | null>(null);

  const completeCount = bank.filter((draft) => toPublishableQuestionInput(draft) !== null).length;
  const evaluation = evaluateBankSize(durationSeconds, completeCount);

  function commitBank(next: QuestionDraft[]) {
    setBank(next);
    onBankChange?.(next);
  }

  function startNew(type: QuestionDraftType) {
    setPickerOpen(false);
    setEditor({ open: true, draft: createEmptyQuestionDraft(type, campaignId), isNew: true });
    setSaveError(null);
  }

  function startEdit(draft: QuestionDraft) {
    setEditor({ open: true, draft, isNew: false });
    setSaveError(null);
  }

  function save() {
    if (!editor.open) {
      return;
    }
    const result = editor.isNew
      ? addQuestionToBank(bank, editor.draft)
      : updateQuestionInBank(bank, editor.draft);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    commitBank(result.value);
    setEditor({ open: false });
    setSaveError(null);
  }

  function remove(questionId: string) {
    const result = removeQuestionFromBank(bank, questionId);
    if (result.ok) {
      commitBank(result.value);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-sans font-semibold text-fg">Question bank</h3>
        {!readOnly ? (
          <Button type="button" size="sm" onClick={() => setPickerOpen(true)}>
            Add question
          </Button>
        ) : null}
      </div>

      <div className="flex items-start gap-2 rounded-md bg-surface-raised px-3 py-2">
        <Badge variant={evaluation.meetsRequirement ? "success" : "warning"} className="shrink-0">
          {evaluation.meetsRequirement ? "Bank size OK" : "Bank too small"}
        </Badge>
        <p className="text-xs font-sans text-fg-muted">{evaluation.message}</p>
      </div>

      {bank.length === 0 ? (
        <p className="text-sm font-sans text-fg-muted">No questions yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bank.map((draft) => (
            <QuestionListRow
              key={draft.id}
              draft={draft}
              onEdit={() => startEdit(draft)}
              onRemove={() => remove(draft.id)}
            />
          ))}
        </ul>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose a question type</DialogTitle>
          </DialogHeader>
          <QuestionTypePicker onPick={startNew} />
        </DialogContent>
      </Dialog>

      <Dialog open={editor.open} onOpenChange={(open) => !open && setEditor({ open: false })}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editor.open && editor.isNew ? "Add question" : "Edit question"}
            </DialogTitle>
          </DialogHeader>
          {editor.open ? (
            <div className="flex flex-col gap-4">
              <QuestionEditor
                draft={editor.draft}
                onChange={(draft) => setEditor({ open: true, draft, isNew: editor.isNew })}
              />
              {saveError ? (
                <p role="alert" className="text-xs font-sans text-danger">
                  {questionBankActionErrorMessage(saveError)}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditor({ open: false })}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={save}>
                  Save question
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
