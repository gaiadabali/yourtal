import "server-only";

import { z } from "zod";
import { regionSchema } from "@yourtal/contracts/region";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";
import { consentsResponseSchema } from "@/features/me/me-schemas";
import type { ConsentsResponse } from "@/features/me/me-schemas";

/**
 * Live reads for the onboarding flow (6.2.b), the same one-function-per-`GET`
 * shape `features/me/me-data.ts` already uses — each page runs its own read
 * and hands the `ApiResult` straight to its client step, so a dead endpoint
 * degrades only that step.
 */

export function getOnboardingConsents(): Promise<ApiResult<ConsentsResponse>> {
  return apiFetch("/api/me/consents", consentsResponseSchema);
}

const followCandidateSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  handle: z.string(),
  logoUrl: z.string().nullable(),
  region: regionSchema,
});
export const followCandidatesResponseSchema = z.object({
  candidates: z.array(followCandidateSchema),
});
export type FollowCandidatesResponse = z.infer<typeof followCandidatesResponseSchema>;
export type FollowCandidate = z.infer<typeof followCandidateSchema>;

export function getFollowCandidates(): Promise<ApiResult<FollowCandidatesResponse>> {
  return apiFetch("/api/me/follows/candidates", followCandidatesResponseSchema);
}
