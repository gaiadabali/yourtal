import { z } from "zod";

/**
 * The question bank, and the rules that gate a campaign's approval.
 * YT-0102.
 *
 * ## Under O-1 this is a reward gate, not a scoring garnish
 *
 * The founder's rule pays only on the full video **and** the questions, so a
 * campaign whose bank is thin does not merely score poorly — it is the
 * second half of whether anybody gets paid at all. That is why the two size
 * rules below are enforced at approval rather than suggested in the editor:
 * a suggestion is something an advertiser dismisses at 2am before a launch.
 */

/**
 * How many questions a campaign of this length asks.
 *
 * *"Max 1 question per 5 minutes of video, capped at 5."* A 30-minute video
 * would earn 6 by the rate and is held at 5; a 4-minute video earns none.
 *
 * Zero is a real answer, not an error. A Quick campaign is sixty seconds and
 * asking it a question would be absurd — but note the consequence, which is
 * the interesting part: with `scoringRule: "base_only"` and no questions,
 * `questionsAnswered` is vacuously satisfied, and completion rests entirely
 * on coverage. `campaignSchema` already forbids an accuracy bonus with no
 * questions to score, which is what keeps that from being a free reward.
 */
export const SECONDS_PER_QUESTION = 5 * 60;
export const MAX_QUESTIONS_ASKED = 5;

export function questionsAskedFor(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.min(Math.floor(durationSeconds / SECONDS_PER_QUESTION), MAX_QUESTIONS_ASKED);
}

/**
 * *"Bank must be ≥3× the number asked."*
 *
 * The ratio is what makes a per-user random subset (YT-0122) mean anything.
 * With a bank the same size as the ask, every viewer sees every question and
 * a single leaked set covers the whole campaign forever. At 3× a leak covers
 * a third of what any given viewer might face, and the population accuracy
 * signal `docs/18` §11 depends on still has unknowing viewers to measure.
 */
export const BANK_MULTIPLE = 3;

export function requiredBankSize(durationSeconds: number): number {
  return questionsAskedFor(durationSeconds) * BANK_MULTIPLE;
}

/**
 * Whether a question may currently be asked.
 *
 * `retired` is not a delete. `docs/18` §11 expects the answer key to leak
 * and wants the response to be automatic — population accuracy jumping from
 * 61% to 97% overnight retires the question and flags the cohort. A deleted
 * question takes its own evidence with it, and the cohort that answered it
 * could no longer be identified afterwards.
 */
export const questionStatusSchema = z.enum([
  /** Written, not yet screened or approved. Never asked. */
  "draft",
  /** Screened and approved. Eligible for a viewer's subset. */
  "approved",
  /** Withdrawn — by an author, or automatically on a leak signal. */
  "retired",
]);

export type QuestionStatus = z.infer<typeof questionStatusSchema>;

/**
 * The verdict of the PII screen (`docs/18` §6).
 *
 * A reward-gated question is a uniquely effective way to harvest data a
 * business could not otherwise ask for: the viewer is mid-reward and
 * motivated to answer. So screening is a **state a question must be in**
 * rather than a review note somebody writes — `canApprove` refuses without
 * it, which is what makes the requirement checkable instead of aspirational.
 *
 * `needs_review` is distinct from `rejected` on purpose. An automated screen
 * that can only pass or fail either blocks legitimate questions or waves
 * borderline ones through, and "a human has not looked yet" is a different
 * fact from "a human said no".
 */
export const piiScreenVerdictSchema = z.enum(["clear", "needs_review", "rejected"]);
export type PiiScreenVerdict = z.infer<typeof piiScreenVerdictSchema>;

export const bankQuestionSchema = z.object({
  questionId: z.uuid(),
  campaignId: z.uuid(),
  status: questionStatusSchema,
  piiScreen: piiScreenVerdictSchema.nullable(),
  /**
   * Counters, not a stored accuracy rate.
   *
   * `docs/18` §11 needs population accuracy per question and needs it to be
   * cheap. Storing the RATE would be a derived value that a concurrent
   * answer can corrupt — the same rule the ledger follows for balances — and
   * it would lose the denominator, so "97%" from four answers could not be
   * told from "97%" from four thousand. A leak detector that cannot tell
   * those apart fires on noise and gets muted.
   */
  timesAsked: z.number().int().min(0),
  timesCorrect: z.number().int().min(0),
  retiredReason: z.string().max(280).nullable(),
});

export type BankQuestion = z.infer<typeof bankQuestionSchema>;

/** Population accuracy, derived. `null` when nobody has answered yet. */
export function populationAccuracy(question: BankQuestion): number | null {
  if (question.timesAsked === 0) return null;
  return question.timesCorrect / question.timesAsked;
}

export type ApprovalRefusal =
  | { readonly kind: "bank_too_small"; readonly have: number; readonly need: number }
  | { readonly kind: "unscreened"; readonly questionIds: readonly string[] }
  | { readonly kind: "screen_rejected"; readonly questionIds: readonly string[] }
  | { readonly kind: "no_questions_required"; readonly detail: string };

/**
 * Whether a campaign's bank is good enough to publish.
 *
 * Counts only `approved` questions with a clear screen. A bank padded with
 * drafts would satisfy a raw count while leaving nothing askable — and the
 * failure would appear at the checkpoint, after the viewer had already
 * watched the whole video.
 */
export function judgeBankForApproval(
  bank: readonly BankQuestion[],
  durationSeconds: number,
): ApprovalRefusal | "approved" {
  const need = requiredBankSize(durationSeconds);

  if (need === 0) {
    // Nothing to check, and saying so beats returning "approved" for a
    // campaign that will never ask a question — the caller usually wants to
    // know which case it is.
    return {
      kind: "no_questions_required",
      detail: `A ${String(durationSeconds)}s campaign asks no questions, so it needs no bank.`,
    };
  }

  const rejected = bank.filter((question) => question.piiScreen === "rejected");
  if (rejected.length > 0) {
    return { kind: "screen_rejected", questionIds: rejected.map((q) => q.questionId) };
  }

  const unscreened = bank.filter(
    (question) => question.status === "approved" && question.piiScreen !== "clear",
  );
  if (unscreened.length > 0) {
    return { kind: "unscreened", questionIds: unscreened.map((q) => q.questionId) };
  }

  const askable = bank.filter(
    (question) => question.status === "approved" && question.piiScreen === "clear",
  );
  if (askable.length < need) {
    return { kind: "bank_too_small", have: askable.length, need };
  }

  return "approved";
}

export function describeApprovalRefusal(refusal: ApprovalRefusal): string {
  switch (refusal.kind) {
    case "bank_too_small":
      return (
        `This campaign asks ${String(refusal.need / BANK_MULTIPLE)} questions and needs a bank of ` +
        `${String(refusal.need)} — ${String(BANK_MULTIPLE)}x — but only ${String(refusal.have)} are approved and screened.`
      );
    case "unscreened":
      return `${String(refusal.questionIds.length)} question(s) have not passed the PII screen. A reward-gated question is a uniquely effective way to harvest data, so screening is required rather than advised.`;
    case "screen_rejected":
      return `${String(refusal.questionIds.length)} question(s) were rejected by the PII screen and must be removed or rewritten.`;
    case "no_questions_required":
      return refusal.detail;
  }
}
