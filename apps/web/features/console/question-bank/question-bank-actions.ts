import type { QuestionDraft } from "./question-draft";
import { detectPiiRequest } from "./question-pii-guard";

/**
 * Pure question-bank mutations, mirroring `features/console/team-actions.ts`'s
 * `{ ok: true, value } | { ok: false, error }` shape rather than throwing for
 * an expected refusal (docs/13b-typescript-standards.md §4's discipline,
 * applied without `neverthrow` for the same reason `team-actions.ts` does
 * not use it — see that file's doc comment: no live API exists yet, and this
 * operates on the in-memory bank array `question-bank-screen.tsx` holds in
 * `useState`).
 *
 * The PII guard runs here too, not only in the field component's live
 * inline message — docs/06 §4.1 says the UI "must reject" a PII-harvesting
 * question, not merely warn about one, so a flagged prompt cannot actually
 * be saved into the bank even if a caller bypasses the inline warning.
 */
export type QuestionBankActionError =
  | { type: "pii_request"; category: string; reason: string }
  | { type: "empty_prompt" }
  | { type: "not_found" };

export type QuestionBankActionResult<T> =
  { ok: true; value: T } | { ok: false; error: QuestionBankActionError };

function validatePrompt(draft: QuestionDraft): QuestionBankActionError | null {
  if (draft.prompt.trim().length === 0) {
    return { type: "empty_prompt" };
  }
  const finding = detectPiiRequest(draft.prompt);
  if (finding) {
    return { type: "pii_request", category: finding.category, reason: finding.reason };
  }
  return null;
}

export function addQuestionToBank(
  bank: readonly QuestionDraft[],
  draft: QuestionDraft,
): QuestionBankActionResult<QuestionDraft[]> {
  const error = validatePrompt(draft);
  if (error) {
    return { ok: false, error };
  }
  return { ok: true, value: [...bank, draft] };
}

export function updateQuestionInBank(
  bank: readonly QuestionDraft[],
  draft: QuestionDraft,
): QuestionBankActionResult<QuestionDraft[]> {
  const error = validatePrompt(draft);
  if (error) {
    return { ok: false, error };
  }
  const index = bank.findIndex((question) => question.id === draft.id);
  if (index === -1) {
    return { ok: false, error: { type: "not_found" } };
  }
  const next = [...bank];
  next[index] = draft;
  return { ok: true, value: next };
}

export function removeQuestionFromBank(
  bank: readonly QuestionDraft[],
  questionId: string,
): QuestionBankActionResult<QuestionDraft[]> {
  if (!bank.some((question) => question.id === questionId)) {
    return { ok: false, error: { type: "not_found" } };
  }
  return { ok: true, value: bank.filter((question) => question.id !== questionId) };
}

export function questionBankActionErrorMessage(error: QuestionBankActionError): string {
  switch (error.type) {
    case "pii_request":
      return error.reason;
    case "empty_prompt":
      return "Write the question prompt before saving it.";
    case "not_found":
      return "That question is no longer in the bank — it may already have been removed.";
    default: {
      const exhaustive: never = error;
      throw new Error(`Unhandled question bank action error: ${JSON.stringify(exhaustive)}`);
    }
  }
}
