import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { detectPiiRequest, detectPredictionRequest } from "@yourtal/contracts/question/pii-guard";
import type { CampaignDraftRepository } from "../persistence/campaign-draft.repository";
import type {
  BankQuestionRecord,
  NewQuestion,
  QuestionBankRepository,
} from "../persistence/question-bank.repository";
import type { UpdateQuestionError } from "../studio.errors";

/**
 * TASKS.md 7.3.i: edits one already-authored question. Same two red-line
 * guards `create-question.use-case.ts` runs, re-run here because the prompt
 * (or any other field) may have just changed -- an edit that skipped the
 * guard would be a second, unscreened way into the bank.
 *
 * Refused once the campaign has left `draft` -- the same "an advertiser
 * edits freely only until submission" rule `campaign-draft.controller.ts`'s
 * own PATCH already enforces (`CampaignNotDraftError`); a question's
 * content is as much draft CRUD as the campaign shell around it, and the
 * 7.3.i Check asks for exactly this on both PATCH and DELETE.
 *
 * `status` always resets to `draft` on a successful edit (see
 * `QuestionBankRepository.update`'s own doc comment): an edited question has
 * not been re-approved, whatever it was before.
 */
export function updateQuestion(
  deps: { readonly drafts: CampaignDraftRepository; readonly bank: QuestionBankRepository },
  businessId: string,
  campaignId: string,
  questionId: string,
  question: NewQuestion,
): ResultAsync<BankQuestionRecord, UpdateQuestionError> {
  const piiFinding = detectPiiRequest(question.prompt);
  if (piiFinding !== null) {
    return errAsync({
      type: "pii_request",
      category: piiFinding.category,
      reason: piiFinding.reason,
    });
  }
  const predictionFinding = detectPredictionRequest(question.prompt);
  if (predictionFinding !== null) {
    return errAsync({ type: "prediction_request", reason: predictionFinding.reason });
  }

  return ResultAsync.fromPromise(deps.bank.findById(questionId), (cause): UpdateQuestionError => ({
    type: "persistence_failed",
    cause: String(cause),
  })).andThen((existing) => {
    // Scoped to :campaignId the same way a 404 on a wrong id would be --
    // never disclosing that a question exists under a DIFFERENT campaign.
    if (existing === null || existing.question.campaignId !== campaignId) {
      return errAsync<BankQuestionRecord, UpdateQuestionError>({
        type: "question_not_found",
        questionId,
      });
    }
    if (existing.question.type !== question.type) {
      return errAsync<BankQuestionRecord, UpdateQuestionError>({
        type: "question_type_immutable",
      });
    }
    return ResultAsync.fromPromise(
      deps.drafts.findById(businessId, campaignId),
      (cause): UpdateQuestionError => ({ type: "persistence_failed", cause: String(cause) }),
    ).andThen((draft) => {
      if (draft === null) {
        return errAsync<BankQuestionRecord, UpdateQuestionError>({
          type: "campaign_not_found",
          campaignId,
        });
      }
      if (draft.lifecycleState !== "draft") {
        return errAsync<BankQuestionRecord, UpdateQuestionError>({ type: "campaign_not_draft" });
      }
      return ResultAsync.fromPromise(
        deps.bank.update(questionId, question, "clear"),
        (cause): UpdateQuestionError => ({ type: "persistence_failed", cause: String(cause) }),
      ).andThen((updated) =>
        updated === null
          ? errAsync<BankQuestionRecord, UpdateQuestionError>({
              type: "question_not_found",
              questionId,
            })
          : okAsync(updated),
      );
    });
  });
}
