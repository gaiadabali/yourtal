/**
 * The two hard platform guardrails on a campaign's question bank
 * (docs/06-longform-video-and-attention.md §4.1):
 *
 *   "Maximum 3–5 questions per campaign, hard-capped by video length
 *   (e.g. 1 question per 5 minutes, max 5)."
 *
 *   "Question bank must be ≥ 3× the number asked — this is the
 *   anti-sharing requirement, and it is enforced at campaign approval,
 *   not suggested."
 *
 * Both are enforced here as pure functions so `question-bank-screen.tsx`
 * can show the live, worked-out numbers rather than a flat "not enough
 * questions" — per this ticket's acceptance criterion, "enforced in the UI
 * with an explanation, not a silent block."
 */

import { questionsAskedFor } from "../../player/question-schedule";

const BANK_SIZE_MULTIPLE = 3;

/**
 * How many questions a viewer is asked per attempt: none under a minute,
 * one from a minute, then one per 5 minutes capped at 5. The player's own
 * mirror of `questionsAskedFor`, so this screen cannot disagree with the
 * server's rule (it once did: it said "none" for anything under 5 minutes).
 */
export const computeMaxAskedQuestions = questionsAskedFor;

/** The anti-sharing minimum bank size for a given asked count: at least 3x, so no single shared answer key covers every viewer. */
export function computeMinBankSize(askedCount: number): number {
  return askedCount * BANK_SIZE_MULTIPLE;
}

export interface BankSizeEvaluation {
  askedCount: number;
  requiredBankSize: number;
  actualBankSize: number;
  meetsRequirement: boolean;
  /** Which explanation applies; `describeBankSize` words it for the viewer (the explanation this ticket asks for, not just a boolean). */
  kind: "not_required" | "ok" | "short";
}

/**
 * Evaluates one campaign's bank against the anti-sharing rule for its
 * video length. `actualBankSize` should be the count of COMPLETE questions
 * (see `toPublishableQuestionInput`) — an empty in-progress draft does not
 * yet defend against anything.
 */
export function evaluateBankSize(
  durationSeconds: number,
  actualBankSize: number,
): BankSizeEvaluation {
  const askedCount = computeMaxAskedQuestions(durationSeconds);
  const requiredBankSize = computeMinBankSize(askedCount);
  const meetsRequirement = actualBankSize >= requiredBankSize;

  if (askedCount === 0) {
    return {
      askedCount,
      requiredBankSize,
      actualBankSize,
      meetsRequirement: true,
      kind: "not_required",
    };
  }

  return {
    askedCount,
    requiredBankSize,
    actualBankSize,
    meetsRequirement,
    kind: meetsRequirement ? "ok" : "short",
  };
}

/** The worked-out explanation under the bank-size badge, in the viewer's language. */
export function describeBankSize(
  evaluation: BankSizeEvaluation,
  t: (key: string, values?: Record<string, number>) => string,
): string {
  switch (evaluation.kind) {
    case "not_required":
      return t("questionBank.bankRules.notRequired");
    case "ok":
      return t("questionBank.bankRules.ok", {
        asked: evaluation.askedCount,
        actual: evaluation.actualBankSize,
        required: evaluation.requiredBankSize,
      });
    case "short":
      return t("questionBank.bankRules.short", {
        asked: evaluation.askedCount,
        actual: evaluation.actualBankSize,
        required: evaluation.requiredBankSize,
        missing: evaluation.requiredBankSize - evaluation.actualBankSize,
      });
  }
}
