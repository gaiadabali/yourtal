"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
import {
  createQuestionLive,
  deleteQuestionLive,
  updateQuestionLive,
} from "./question-live-actions";
import { evaluateBankSize } from "./question-bank-rules";
import type { QuestionDraft, QuestionDraftType } from "./question-draft";
import { createEmptyQuestionDraft } from "./question-draft";
import { toPublishableQuestionInput } from "./question-draft-to-question";
import { QuestionEditor } from "./question-editor";
import { QuestionListRow } from "./question-list-row";
import { QuestionTypePicker } from "./question-type-picker";

export interface QuestionBankScreenProps {
  businessId: string;
  campaignId: string;
  /** The campaign's video length — the bank-size rule scales with it (question-bank-rules.ts). */
  durationSeconds: number;
  initialBank: QuestionDraft[];
  /** Lets the campaign editor keep its own `questionCount`/preview in sync without duplicating this state. */
  onBankChange?: (bank: QuestionDraft[]) => void;
  readOnly?: boolean;
  /** Live mode: `save()`/`remove()` call the real `POST`/`PATCH`/`DELETE .../questions` (7.3.b/7.3.i). */
  isLiveMode?: boolean;
  /** TASKS.md 12.3.a: the campaign's own audience, threaded to the editor's inline teen personal-question guard and the mock-mode save gate. The server is the real authority either way (`create-question.use-case.ts`). */
  audience?: string | undefined;
}

type EditorState = { open: false } | { open: true; draft: QuestionDraft; isNew: boolean };

/**
 * A campaign's question bank (YT-0442): the list, an add/edit dialog
 * covering all five types, and the bank-size rule banner — the one client
 * leaf for this whole sub-feature, mounted inside `campaign-editor.tsx`'s
 * "Questions" section.
 *
 * Live mode: `bank` only ever holds server-confirmed rows (a not-yet-saved
 * new draft lives in `editor.draft`, never committed to `bank` until a real
 * `createQuestionLive` succeeds), so every row's Edit/Remove goes straight
 * to the real `PATCH`/`DELETE .../questions/:questionId` (7.3.i). The
 * server's own refusals (PII, prediction, `question_type_immutable`,
 * `campaign_not_draft`) surface inline — for Edit in the same dialog error
 * slot `create`'s refusals already use; for Remove, `removeError` below.
 */
export function QuestionBankScreen({
  businessId,
  campaignId,
  durationSeconds,
  initialBank,
  onBankChange,
  readOnly = false,
  isLiveMode = false,
  audience,
}: QuestionBankScreenProps) {
  const t = useTranslations("studio");
  const [bank, setBank] = useState<QuestionDraft[]>(initialBank);
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveError, setSaveError] = useState<QuestionBankActionError | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

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

  async function save() {
    if (!editor.open) {
      return;
    }
    if (isLiveMode) {
      const liveResult = editor.isNew
        ? await createQuestionLive(businessId, campaignId, editor.draft)
        : await updateQuestionLive(businessId, campaignId, editor.draft);
      if (!liveResult.ok) {
        setSaveError({ type: "api_error", message: liveResult.message });
        return;
      }
      commitBank(
        editor.isNew
          ? [...bank, liveResult.value]
          : bank.map((draft) => (draft.id === liveResult.value.id ? liveResult.value : draft)),
      );
      setEditor({ open: false });
      setSaveError(null);
      return;
    }
    const result = editor.isNew
      ? addQuestionToBank(bank, editor.draft, audience)
      : updateQuestionInBank(bank, editor.draft, audience);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    commitBank(result.value);
    setEditor({ open: false });
    setSaveError(null);
  }

  async function remove(questionId: string) {
    if (isLiveMode) {
      const liveResult = await deleteQuestionLive(businessId, campaignId, questionId);
      if (!liveResult.ok) {
        setRemoveError(liveResult.message);
        return;
      }
      setRemoveError(null);
      // The server soft-retires (status -> "retired", never deleted — docs/06
      // §4.1) but this bank view still drops the row: a business asking to
      // "remove" a question wants it gone from what they see.
      commitBank(bank.filter((draft) => draft.id !== questionId));
      return;
    }
    const result = removeQuestionFromBank(bank, questionId);
    if (result.ok) {
      setRemoveError(null);
      commitBank(result.value);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-sans font-semibold text-fg">{t("questionBank.title")}</h3>
        {!readOnly ? (
          <Button type="button" size="sm" onClick={() => setPickerOpen(true)}>
            {t("questionBank.addQuestion")}
          </Button>
        ) : null}
      </div>

      <div className="flex items-start gap-2 rounded-md bg-surface-raised px-3 py-2">
        <Badge variant={evaluation.meetsRequirement ? "success" : "warning"} className="shrink-0">
          {evaluation.meetsRequirement
            ? t("questionBank.bankSizeOk")
            : t("questionBank.bankTooSmall")}
        </Badge>
        <p className="text-xs font-sans text-fg-muted">{evaluation.message}</p>
      </div>

      {removeError ? (
        <p role="alert" className="text-xs font-sans text-danger">
          {removeError}
        </p>
      ) : null}

      {bank.length === 0 ? (
        <p className="text-sm font-sans text-fg-muted">{t("questionBank.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bank.map((draft) => (
            <QuestionListRow
              key={draft.id}
              draft={draft}
              onEdit={() => startEdit(draft)}
              onRemove={() => void remove(draft.id)}
            />
          ))}
        </ul>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("questionBank.chooseType")}</DialogTitle>
          </DialogHeader>
          <QuestionTypePicker onPick={startNew} />
        </DialogContent>
      </Dialog>

      <Dialog open={editor.open} onOpenChange={(open) => !open && setEditor({ open: false })}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editor.open && editor.isNew
                ? t("questionBank.addQuestion")
                : t("questionBank.editQuestion")}
            </DialogTitle>
          </DialogHeader>
          {editor.open ? (
            <div className="flex flex-col gap-4">
              <QuestionEditor
                draft={editor.draft}
                onChange={(draft) => setEditor({ open: true, draft, isNew: editor.isNew })}
                audience={audience}
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
                  {t("questionBank.cancel")}
                </Button>
                <Button type="button" onClick={() => void save()}>
                  {t("questionBank.saveQuestion")}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
