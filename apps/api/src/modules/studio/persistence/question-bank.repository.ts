import type { Question } from "@yourtal/contracts/question";
import type { PiiScreenVerdict, QuestionStatus } from "@yourtal/contracts/question/bank";

/** A question as Studio's own authoring view sees it — the full `Question` (answer key included; this module IS the author) plus the bank's own moderation/leak-tracking state. */
export interface BankQuestionRecord {
  readonly question: Question;
  readonly status: QuestionStatus;
  readonly piiScreen: PiiScreenVerdict | null;
  readonly timesAsked: number;
  readonly timesCorrect: number;
  readonly retiredReason: string | null;
}

/**
 * A DISTRIBUTIVE omit: `Omit<Question, "id"|"campaignId">` directly would
 * collapse `Question`'s discriminated union into one object type with a
 * widened `type` field, losing the per-variant narrowing every switch on
 * `type` depends on. Distributing over `T extends unknown ? ... : never`
 * applies the omit to EACH union member separately instead, so
 * `NewQuestion` stays a proper discriminated union.
 */
export type NewQuestion<T = Question> = T extends Question ? Omit<T, "id" | "campaignId"> : never;

export interface QuestionBankRepository {
  /** `piiScreen` is decided by `detectPiiRequest`/`detectPredictionRequest` before this is ever called — see `create-question.use-case.ts`. */
  create(
    campaignId: string,
    question: NewQuestion,
    piiScreen: PiiScreenVerdict,
  ): Promise<BankQuestionRecord>;
  listByCampaign(campaignId: string): Promise<readonly BankQuestionRecord[]>;
  findById(questionId: string): Promise<BankQuestionRecord | null>;
  updateStatus(
    questionId: string,
    status: QuestionStatus,
    retiredReason: string | null,
  ): Promise<BankQuestionRecord | null>;
}

export const QUESTION_BANK_REPOSITORY = Symbol("QUESTION_BANK_REPOSITORY");
