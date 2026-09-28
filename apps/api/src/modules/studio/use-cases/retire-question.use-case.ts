import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { CampaignDraftRepository } from "../persistence/campaign-draft.repository";
import type {
  BankQuestionRecord,
  QuestionBankRepository,
} from "../persistence/question-bank.repository";
import type { RetireQuestionError } from "../studio.errors";

const AUTHOR_WITHDRAWN_REASON =
  "Withdrawn by the author while the campaign was still a draft (7.3.i).";

/**
 * TASKS.md 7.3.i: "DELETE" a question. A real row delete would take its own
 * evidence with it (`question-bank.ts`'s own doc comment on `retired`:
 * "the cohort that answered it could no longer be identified afterwards"),
 * and `retired`'s status already carries the author-withdrawal meaning
 * alongside its automated-leak one ("Withdrawn — by an author, or
 * automatically on a leak signal") -- so this soft-retires through the
 * SAME `updateStatus` write path the leak detector will one day use, rather
 * than adding a second delete mechanism and a second status value.
 *
 * Gated on the CAMPAIGN still being `draft`, not the question's own ask
 * count: a still-draft campaign can never have asked anything yet (nothing
 * plays before `live`), so refusing here is equivalent to refusing "this
 * question has already been asked in a published campaign" -- the exact
 * rule this ticket asks for, checked at the point that is actually
 * reachable from every draft campaign's own lifecycle.
 */
export function retireQuestion(
  deps: { readonly drafts: CampaignDraftRepository; readonly bank: QuestionBankRepository },
  businessId: string,
  campaignId: string,
  questionId: string,
): ResultAsync<BankQuestionRecord, RetireQuestionError> {
  return ResultAsync.fromPromise(deps.bank.findById(questionId), (cause): RetireQuestionError => ({
    type: "persistence_failed",
    cause: String(cause),
  })).andThen((existing) => {
    if (existing === null || existing.question.campaignId !== campaignId) {
      return errAsync<BankQuestionRecord, RetireQuestionError>({
        type: "question_not_found",
        questionId,
      });
    }
    return ResultAsync.fromPromise(
      deps.drafts.findById(businessId, campaignId),
      (cause): RetireQuestionError => ({ type: "persistence_failed", cause: String(cause) }),
    ).andThen((draft) => {
      if (draft === null) {
        return errAsync<BankQuestionRecord, RetireQuestionError>({
          type: "campaign_not_found",
          campaignId,
        });
      }
      if (draft.lifecycleState !== "draft") {
        return errAsync<BankQuestionRecord, RetireQuestionError>({ type: "campaign_not_draft" });
      }
      return ResultAsync.fromPromise(
        deps.bank.updateStatus(questionId, "retired", AUTHOR_WITHDRAWN_REASON),
        (cause): RetireQuestionError => ({ type: "persistence_failed", cause: String(cause) }),
      ).andThen((updated) =>
        updated === null
          ? errAsync<BankQuestionRecord, RetireQuestionError>({
              type: "question_not_found",
              questionId,
            })
          : okAsync(updated),
      );
    });
  });
}
