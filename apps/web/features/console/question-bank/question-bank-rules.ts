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

const MAX_ASKED_QUESTIONS = 5;
const SECONDS_PER_ASKED_QUESTION_SLOT = 5 * 60;
const BANK_SIZE_MULTIPLE = 3;

/** How many questions a viewer is asked per attempt, driven by video length: one slot per 5 minutes, capped at 5. */
export function computeMaxAskedQuestions(durationSeconds: number): number {
  const slots = Math.floor(durationSeconds / SECONDS_PER_ASKED_QUESTION_SLOT);
  return Math.max(0, Math.min(MAX_ASKED_QUESTIONS, slots));
}

/** The anti-sharing minimum bank size for a given asked count: at least 3x, so no single shared answer key covers every viewer. */
export function computeMinBankSize(askedCount: number): number {
  return askedCount * BANK_SIZE_MULTIPLE;
}

export interface BankSizeEvaluation {
  askedCount: number;
  requiredBankSize: number;
  actualBankSize: number;
  meetsRequirement: boolean;
  /** Always populated — the explanation this ticket asks for, not just a boolean. */
  message: string;
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
      message:
        "This video is too short to ask a checkpoint question (minimum 5 minutes for one). No question bank is required.",
    };
  }

  const message = meetsRequirement
    ? `A viewer is asked ${askedCount} question${askedCount === 1 ? "" : "s"} per attempt, drawn at random from your bank of ${actualBankSize}. That is at or above the 3x anti-sharing minimum (${requiredBankSize}), so a leaked answer key can only ever cover a fraction of what any one viewer sees.`
    : `A viewer is asked ${askedCount} question${askedCount === 1 ? "" : "s"} per attempt. Your bank needs at least ${requiredBankSize} complete questions (3x the asked count) so a shared answer key can't cover everyone who watches — you currently have ${actualBankSize}. Add ${requiredBankSize - actualBankSize} more before this campaign can go to review.`;

  return { askedCount, requiredBankSize, actualBankSize, meetsRequirement, message };
}
