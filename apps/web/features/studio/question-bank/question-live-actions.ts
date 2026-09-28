"use server";

import { z } from "zod";
import { questionSchema } from "@yourtal/contracts/question";
import type { Question } from "@yourtal/contracts/question";
import { piiScreenVerdictSchema, questionStatusSchema } from "@yourtal/contracts/question/bank";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";
import type { QuestionDraft } from "./question-draft";
import { toPublishableQuestionInput } from "./question-draft-to-question";

/**
 * `apps/api`'s `BankQuestionRecord` (`question-bank.repository.ts`) — the
 * real `GET`/`POST .../questions` response, one bank row wrapping its own
 * `Question` rather than the flat question shape itself. Restated here for
 * the same reason `campaign-draft-live-response.ts` restates its own API
 * shape: a server can't import another app's types.
 */
const bankQuestionRecordSchema = z.object({
  question: questionSchema,
  status: questionStatusSchema,
  piiScreen: piiScreenVerdictSchema.nullable(),
  timesAsked: z.number(),
  timesCorrect: z.number(),
  retiredReason: z.string().nullable(),
});

/**
 * The real `apps/api/src/modules/studio/question-bank.controller.ts`
 * endpoints (7.3.b, merged to `main`) — `GET`/`POST
 * .../studio/campaigns/:campaignId/questions`. `question-bank-actions.ts`'s
 * pure functions stay as they are and keep running the mock flow;
 * `question-bank-screen.tsx` calls this file instead when `isLiveMode`,
 * mirroring `team-live-actions.ts`'s split.
 *
 * There is no live `PATCH`/`DELETE` for an individual question — the real
 * controller is list/create only (append-only bank, matching docs/06 §4.1's
 * "retired, never deleted" model for a PUBLISHED question; there is
 * currently no route to edit or remove a DRAFT one either). Flagged as a
 * `(requested by D/7.8)` subtask under 7.3 in TASKS.md rather than faked
 * here — `question-bank-screen.tsx` disables edit/remove for any question
 * this file has already confirmed the server holds.
 */
export type QuestionLiveActionResult<T> = { ok: true; value: T } | { ok: false; message: string };

function mapApiError(error: ApiError): string {
  return error.message;
}

/** A question the server has confirmed (came back from a real `GET`/`POST`) — never from local, unsaved draft state. */
function questionToDraft(question: Question): QuestionDraft {
  const shared = {
    id: question.id,
    campaignId: question.campaignId,
    prompt: question.prompt,
    timerSeconds: question.timerSeconds,
    answerableAfterSeconds: question.answerableAfterSeconds,
  };
  switch (question.type) {
    case "multiple_choice":
      return {
        ...shared,
        type: question.type,
        options: question.options.map((option) => ({ id: option.id, label: option.label })),
        correctOptionId: question.correctOptionId,
      };
    case "true_false":
      return { ...shared, type: question.type, correctAnswer: question.correctAnswer };
    case "likert":
      return {
        ...shared,
        type: question.type,
        scaleMin: question.scaleMin,
        scaleMax: question.scaleMax,
        scaleLowLabel: question.scaleLowLabel,
        scaleHighLabel: question.scaleHighLabel,
      };
    case "ranked":
      return {
        ...shared,
        type: question.type,
        items: question.items.map((item) => ({ id: item.id, label: item.label })),
      };
    case "short_text":
      return { ...shared, type: question.type, maxLength: question.maxLength };
    default: {
      const exhaustive: never = question;
      throw new Error(`Unhandled question type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** `GET /api/:tenantId/studio/campaigns/:campaignId/questions` (7.3.b) — fetched once when opening a campaign live, the same reason `team-data.ts` fetches Team's roster separately from the cheap per-zone read. */
export async function listQuestionsLive(
  businessId: string,
  campaignId: string,
): Promise<QuestionLiveActionResult<QuestionDraft[]>> {
  const result = await apiFetch(
    `/api/${businessId}/studio/campaigns/${campaignId}/questions`,
    z.array(bankQuestionRecordSchema),
  );
  if (!result.ok) return { ok: false, message: mapApiError(result.error) };
  return { ok: true, value: result.data.map((record) => questionToDraft(record.question)) };
}

/**
 * `POST /api/:tenantId/studio/campaigns/:campaignId/questions` (7.3.b) —
 * server-side PII and prediction-question guards run here for real; a
 * refusal comes back as an ordinary `ok:false` with the server's own
 * message, shown inline in the add/edit dialog exactly where a client-side
 * refusal already shows (`question-bank-actions.ts`'s `QuestionBankActionError`
 * path), never silently dropped.
 */
export async function createQuestionLive(
  businessId: string,
  campaignId: string,
  draft: QuestionDraft,
): Promise<QuestionLiveActionResult<QuestionDraft>> {
  const publishable = toPublishableQuestionInput(draft);
  if (publishable === null) {
    return { ok: false, message: "This question is not finished yet." };
  }
  const result = await apiFetch(
    `/api/${businessId}/studio/campaigns/${campaignId}/questions`,
    bankQuestionRecordSchema,
    { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: publishable },
  );
  if (!result.ok) return { ok: false, message: mapApiError(result.error) };
  return { ok: true, value: questionToDraft(result.data.question) };
}
