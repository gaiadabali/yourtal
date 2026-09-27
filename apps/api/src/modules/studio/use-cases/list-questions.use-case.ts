import { ResultAsync } from "neverthrow";
import type {
  BankQuestionRecord,
  QuestionBankRepository,
} from "../persistence/question-bank.repository";
import type { ListQuestionsError } from "../studio.errors";

export function listQuestions(
  bank: QuestionBankRepository,
  campaignId: string,
): ResultAsync<readonly BankQuestionRecord[], ListQuestionsError> {
  return ResultAsync.fromPromise(bank.listByCampaign(campaignId), (cause): ListQuestionsError => ({
    type: "persistence_failed",
    cause: String(cause),
  }));
}
