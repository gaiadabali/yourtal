import { errAsync, ResultAsync } from "neverthrow";
import {
  detectPiiRequest,
  detectPredictionRequest,
  detectTeenPersonalQuestion,
} from "@yourtal/contracts/question/pii-guard";
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
 *
 * TASKS.md 12.3.a: the draft is fetched before the guards run (moved ahead
 * of where 7.3.b left it) so its own audience is in hand for the extra
 * personal-question guard below -- a teen OR all_ages campaign gets one
 * extra, hard refusal no adult/parents campaign does; every audience still
 * gets the universal PII/prediction guards unconditionally.
 *
 * 12.4.c (F83): widened from teen-only to teen-or-all_ages -- a teen account
 * reaches `all_ages` campaigns too (`reachesAudience`), so an all_ages
 * question bank needed the same minimising guard a teen-audience one always
 * had.
 */
export function createQuestion(
  deps: { readonly drafts: CampaignDraftRepository; readonly bank: QuestionBankRepository },
  businessId: string,
  campaignId: string,
  question: NewQuestion,
): ResultAsync<BankQuestionRecord, CreateQuestionError> {
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

    const piiFinding = detectPiiRequest(question.prompt);
    if (piiFinding !== null) {
      return errAsync<BankQuestionRecord, CreateQuestionError>({
        type: "pii_request",
        category: piiFinding.category,
        reason: piiFinding.reason,
      });
    }
    const predictionFinding = detectPredictionRequest(question.prompt);
    if (predictionFinding !== null) {
      return errAsync<BankQuestionRecord, CreateQuestionError>({
        type: "prediction_request",
        reason: predictionFinding.reason,
      });
    }
    if (draft.audience === "teen" || draft.audience === "all_ages") {
      const personalFinding = detectTeenPersonalQuestion(question.prompt);
      if (personalFinding !== null) {
        return errAsync<BankQuestionRecord, CreateQuestionError>({
          type: "teen_personal_question",
          category: personalFinding.category,
          reason: personalFinding.reason,
        });
      }
    }
    // Screened clear the moment it passes every guard above — a stricter
    // human review queue (9.2) is a later concern this ticket does not
    // build; "clear" here means "the automated screen found nothing", the
    // same meaning `pii_screen`'s own column comment gives it.
    return ResultAsync.fromPromise(
      deps.bank.create(campaignId, question, "clear"),
      (cause): CreateQuestionError => ({ type: "persistence_failed", cause: String(cause) }),
    );
  });
}
