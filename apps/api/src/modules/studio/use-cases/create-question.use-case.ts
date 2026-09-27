import { errAsync, ResultAsync } from "neverthrow";
import { detectPiiRequest, detectPredictionRequest } from "@yourtal/contracts/question/pii-guard";
import type { CampaignDraftRepository } from "../persistence/campaign-draft.repository";
import type {
  BankQuestionRecord,
  NewQuestion,
  QuestionBankRepository,
} from "../persistence/question-bank.repository";
import type { CreateQuestionError } from "../studio.errors";

/**
 * TASKS.md 7.3.b: the PII guard and the red-line-1 prediction guard both
 * run here, server-side, as the real gate — not the client-side copy this
 * heuristic used to be the only one of
 * (docs/audit/2026-09-25/business-merchant.md). Rejected outright, not
 * flagged for later: a business calling the API directly bypassed the old
 * client-only guard entirely.
 */
export function createQuestion(
  deps: { readonly drafts: CampaignDraftRepository; readonly bank: QuestionBankRepository },
  businessId: string,
  campaignId: string,
  question: NewQuestion,
): ResultAsync<BankQuestionRecord, CreateQuestionError> {
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

  return ResultAsync.fromPromise(
    deps.drafts.findById(businessId, campaignId),
    (cause): CreateQuestionError => ({ type: "persistence_failed", cause: String(cause) }),
  ).andThen((draft) => {
    if (draft === null) {
      return errAsync<BankQuestionRecord, CreateQuestionError>({
        type: "campaign_not_found",
        campaignId,
      });
    }
    // Screened clear the moment it passes both guards above — a stricter
    // human review queue (9.2) is a later concern this ticket does not
    // build; "clear" here means "the automated screen found nothing", the
    // same meaning `pii_screen`'s own column comment gives it.
    return ResultAsync.fromPromise(
      deps.bank.create(campaignId, question, "clear"),
      (cause): CreateQuestionError => ({ type: "persistence_failed", cause: String(cause) }),
    );
  });
}
