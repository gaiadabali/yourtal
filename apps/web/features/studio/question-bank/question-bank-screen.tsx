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
import { createQuestionLive } from "./question-live-actions";
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
  /** Live mode: `save()` calls the real `POST .../questions` (7.3.b), and a question already confirmed by the server can no longer be edited or removed — see this module's own doc comment. */
  isLiveMode?: boolean;
}

type EditorState = { open: false } | { open: true; draft: QuestionDraft; isNew: boolean };

/**
 * A campaign's question bank (YT-0442): the list, an add/edit dialog
 * covering all five types, and the bank-size rule banner — the one client
 * leaf for this whole sub-feature, mounted inside `campaign-editor.tsx`'s
 * "Questions" section.
 *
 * Live mode's real controller (7.3.b) is list/create only — there is no
 * `PATCH`/`DELETE` for an individual question yet (flagged as a
 * `(requested by D/7.8)` subtask under 7.3 in TASKS.md). So in live mode,
 * `confirmedIds` tracks which rows the server has actually accepted (came
 * back from `initialBank`, itself sourced from a real `GET`, or from a
 * successful `createQuestionLive`) — those rows lose their Edit/Remove
 * actions rather than pretending a local edit changed anything server-side.
 * A brand-new, not-yet-saved draft can still be edited freely before its
 * first save.
 */
export function QuestionBankScreen({
  businessId,
  campaignId,
  durationSeconds,
  initialBank,
  onBankChange,
  readOnly = false,
  isLiveMode = false,
}: QuestionBankScreenProps) {
  const t = useTranslations("studio");
  const [bank, setBank] = useState<QuestionDraft[]>(initialBank);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(
    () => new Set(isLiveMode ? initialBank.map((draft) => draft.id) : []),
  );
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

  async function save() {
    if (!editor.open) {
      return;
    }
    if (isLiveMode && editor.isNew) {
      const liveResult = await createQuestionLive(businessId, campaignId, editor.draft);
      if (!liveResult.ok) {
        setSaveError({ type: "api_error", message: liveResult.message });
        return;
      }
      commitBank([...bank, liveResult.value]);
      setConfirmedIds((current) => new Set(current).add(liveResult.value.id));
      setEditor({ open: false });
      setSaveError(null);
      return;
    }
    // Live edit of an already-confirmed question has no real endpoint yet
    // (this component's own doc comment) — `QuestionListRow` below never
    // offers Edit for a confirmed row in live mode, so this branch is only
    // ever mock mode or a live, not-yet-saved new draft.
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
    // No live DELETE exists yet — `QuestionListRow` never offers Remove for
    // a confirmed row in live mode, so this only ever runs in mock mode or
    // against a (never-reached, since it would already be confirmed) live
    // draft.
    const result = removeQuestionFromBank(bank, questionId);
    if (result.ok) {
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

      {bank.length === 0 ? (
        <p className="text-sm font-sans text-fg-muted">{t("questionBank.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bank.map((draft) => {
            const locked = isLiveMode && confirmedIds.has(draft.id);
            return (
              <QuestionListRow
                key={draft.id}
                draft={draft}
                {...(locked ? {} : { onEdit: () => startEdit(draft), onRemove: () => remove(draft.id) })}
              />
            );
          })}
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
