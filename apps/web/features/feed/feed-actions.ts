"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";

const savedSchema = z.object({ saved: z.boolean() });
const okSchema = z.object({ ok: z.boolean() });

export async function setSavedAction(
  campaignId: string,
  saved: boolean,
): Promise<ApiResult<{ saved: boolean }>> {
  return apiFetch(`/api/me/saves/${campaignId}`, savedSchema, {
    method: saved ? "PUT" : "DELETE",
  });
}

export async function notInterestedAction(campaignId: string): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch(`/api/feed/${campaignId}/not-interested`, okSchema, { method: "POST" });
}

const startSchema = z.object({
  session: z.object({ id: z.uuid(), nonEarning: z.boolean() }),
  durationSeconds: z.number().int().positive(),
  alreadyEarned: z.boolean(),
  manifestUrl: z.string().min(1),
});
export type StartedWatch = z.infer<typeof startSchema>;

/** Starts (or resumes) a reward session for a quick campaign earned in the feed (11.4.b). */
export async function startWatchAction(campaignId: string): Promise<ApiResult<StartedWatch>> {
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

const completeSchema = z.object({
  completed: z.boolean(),
  granted: z.boolean(),
  pendingPoints: z.number(),
  unlockAt: z.iso.datetime().optional(),
  reason: z.string().nullable().optional(),
});
export type CompletedWatch = z.infer<typeof completeSchema>;

/** Asks the server to judge the session; it decides from recorded coverage, never from the client. */
export async function completeWatchAction(sessionId: string): Promise<ApiResult<CompletedWatch>> {
  return apiFetch(`/api/watch/sessions/${sessionId}/complete`, completeSchema, {
    method: "POST",
    headers: { "idempotency-key": randomUUID() },
  });
}
