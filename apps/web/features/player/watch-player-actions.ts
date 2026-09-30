"use server";

import { randomUUID } from "node:crypto";
import * as z from "zod";
import type { PresentedQuestion } from "@yourtal/contracts/question/presented-question";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";

/**
 * Server Actions for the long-form watch page (11.5.b), wiring
 * `features/player` to the real `apps/api` watch session — the same
 * `POST /api/watch/sessions*` routes `features/feed/feed-actions.ts` already
 * calls for Quick campaigns. Kept as a separate file (rather than importing
 * theirs) because `features/feed` is owned by a different area session —
 * see TASKS.md "Areas and ownership" — even though the two files end up
 * close to identical.
 */

const sessionSchema = z.object({
  id: z.uuid(),
  nonEarning: z.boolean(),
  nonEarningReason: z.string().nullable(),
  questionsAsked: z.number().int().min(0),
});

const startSchema = z.object({
  session: sessionSchema,
  durationSeconds: z.number().int().positive(),
  alreadyEarned: z.boolean(),
  manifestUrl: z.string().min(1),
});
export type StartedWatch = z.infer<typeof startSchema>;

/** Starts (or resumes) a reward session for the campaign this page is showing (11.5.b). */
export async function startWatchSessionAction(
  campaignId: string,
): Promise<ApiResult<StartedWatch>> {
  return apiFetch("/api/watch/sessions", startSchema, {
    method: "POST",
    headers: { "idempotency-key": randomUUID() },
    body: { campaignId },
  });
}

const progressSchema = z.object({ accepted: z.boolean(), coveredSeconds: z.number() });

/** One watched span. The server merges spans into coverage and refuses implausible ones. */
export async function reportWatchProgressAction(
  sessionId: string,
  fromSeconds: number,
  toSeconds: number,
): Promise<ApiResult<{ accepted: boolean; coveredSeconds: number }>> {
  return apiFetch(`/api/watch/sessions/${sessionId}/progress`, progressSchema, {
    method: "POST",
    body: { fromSeconds, toSeconds, reportedAt: new Date().toISOString() },
  });
}

const gapSchema = z.object({
  fromSecond: z.number().int().min(0),
  toSecond: z.number().int().min(0),
});
const sessionDetailSchema = z.object({
  session: sessionSchema,
  durationSeconds: z.number().int().positive(),
  coveredSeconds: z.number(),
  gaps: z.array(gapSchema),
});
export type WatchSessionDetail = z.infer<typeof sessionDetailSchema>;

/**
 * `GET /api/watch/sessions/:id` (11.5.b) — what the server has actually
 * recorded so far, for the resume prompt: "resume at the first gap" reads
 * `gaps[0]`, never a client-remembered playhead position (the whole point
 * of coverage being server-side, EW-15).
 */
export async function getWatchSessionAction(
  sessionId: string,
): Promise<ApiResult<WatchSessionDetail>> {
  return apiFetch(`/api/watch/sessions/${sessionId}`, sessionDetailSchema);
}

const completeSchema = z.object({
  completed: z.boolean(),
  granted: z.boolean(),
  pendingPoints: z.number(),
  unlockAt: z.iso.datetime().optional(),
  reason: z.string().nullable().optional(),
});
export type CompletedWatch = z.infer<typeof completeSchema>;

/** Asks the server to judge the session; it decides from recorded coverage and answers, never from the client. */
export async function completeWatchSessionAction(
  sessionId: string,
): Promise<ApiResult<CompletedWatch>> {
  return apiFetch(`/api/watch/sessions/${sessionId}/complete`, completeSchema, {
    method: "POST",
    headers: { "idempotency-key": randomUUID() },
  });
}

// A LOCAL structural copy of `@yourtal/contracts/question/presented-question`'s
// `presentedQuestionSchema`, rather than an import of it: `eslint.config.mjs`'s
// EW-04/5.2.e rule restricts every runtime import under
// `@yourtal/contracts/question/*` in apps/web, directory-wide rather than
// file-by-file (it also transitively pulls in `question.ts`, the scoring
// form, for `questionOptionSchema`). `import type { PresentedQuestion }`
// above is erased at build time and unaffected; `satisfies` below ties this
// copy to that type, so a change to the real schema's shape fails this
// file's typecheck rather than silently drifting.
const questionOptionSchema = z.object({ id: z.uuid(), label: z.string().min(1).max(200) });
const presentedBase = {
  id: z.uuid(),
  campaignId: z.uuid(),
  prompt: z.string().min(1).max(300),
  timerSeconds: z.number().int().positive().max(120),
};
const presentedQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    ...presentedBase,
    type: z.literal("multiple_choice"),
    options: z.array(questionOptionSchema).min(2).max(6),
  }),
  z.object({ ...presentedBase, type: z.literal("true_false") }),
  z.object({
    ...presentedBase,
    type: z.literal("likert"),
    scaleMin: z.number().int(),
    scaleMax: z.number().int(),
    scaleLowLabel: z.string().min(1).max(60),
    scaleHighLabel: z.string().min(1).max(60),
  }),
  z.object({
    ...presentedBase,
    type: z.literal("ranked"),
    items: z.array(questionOptionSchema).min(2).max(6),
  }),
  z.object({
    ...presentedBase,
    type: z.literal("short_text"),
    maxLength: z.number().int().positive().max(500),
  }),
]) satisfies z.ZodType<PresentedQuestion>;

const presentCheckpointSchema = z.object({
  question: presentedQuestionSchema,
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
  atSecond: z.number().int().min(0),
  answerTimerMs: z.number().int().positive(),
});
export type PresentedCheckpoint = z.infer<typeof presentCheckpointSchema>;

/**
 * Asks whether the next checkpoint is due yet. A `409` ("not reached") is
 * ordinary, not a failure — the caller just tries again on its next poll
 * (F10: the exact second is a server secret, never computed client-side).
 */
export async function presentCheckpointAction(
  sessionId: string,
  checkpointIndex: number,
): Promise<ApiResult<PresentedCheckpoint>> {
  return apiFetch(
    `/api/watch/sessions/${sessionId}/checkpoints/${String(checkpointIndex)}`,
    presentCheckpointSchema,
    { method: "POST" },
  );
}

const answerSchema = z.object({ answered: z.boolean(), wasCorrect: z.boolean() });

/** Answers the current checkpoint. Timeout is submitted as a token with no selection — scored wrong, never voided. */
export async function answerCheckpointAction(
  sessionId: string,
  checkpointIndex: number,
  token: string,
  selectedOptionId: string | null,
): Promise<ApiResult<{ answered: boolean; wasCorrect: boolean }>> {
  return apiFetch(
    `/api/watch/sessions/${sessionId}/checkpoints/${String(checkpointIndex)}/answer`,
    answerSchema,
    {
      method: "POST",
      body: { token, ...(selectedOptionId === null ? {} : { selectedOptionId }) },
    },
  );
}
