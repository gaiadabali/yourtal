import "server-only";

import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";
import { meResponseSchema } from "@/lib/api/me-schema";
import type { MeResponse } from "@/lib/api/me-schema";
import {
  autoplayResponseSchema,
  consentsResponseSchema,
  followsResponseSchema,
  interestsResponseSchema,
  notificationPreferencesResponseSchema,
} from "./me-schemas";
import type {
  AutoplayResponse,
  ConsentsResponse,
  FollowsResponse,
  InterestsResponse,
  NotificationPreferencesResponse,
} from "./me-schemas";

/**
 * Live reads for the Me page (6.7.a) — one function per `GET`, each a thin
 * `apiFetch` call. `page.tsx` runs every one of these in parallel via
 * `Promise.all` and hands each `ApiResult` straight to the section that
 * owns it, so one dead endpoint degrades only its own section rather than
 * blanking the page (the "API-down state" every Phase 6 screen task
 * requires) — see that file for how each `ApiResult` becomes a
 * loading/empty/error/data render.
 */

export function getMeProfile(): Promise<ApiResult<MeResponse>> {
  return apiFetch("/api/me", meResponseSchema);
}

export function listConsents(): Promise<ApiResult<ConsentsResponse>> {
  return apiFetch("/api/me/consents", consentsResponseSchema);
}

export function listInterests(): Promise<ApiResult<InterestsResponse>> {
  return apiFetch("/api/me/interests", interestsResponseSchema);
}

export function listFollows(): Promise<ApiResult<FollowsResponse>> {
  return apiFetch("/api/me/follows", followsResponseSchema);
}

export function getNotificationPreferences(): Promise<
  ApiResult<NotificationPreferencesResponse>
> {
  return apiFetch("/api/me/notifications/preferences", notificationPreferencesResponseSchema);
}

export function getAutoplaySetting(): Promise<ApiResult<AutoplayResponse>> {
  return apiFetch("/api/me/settings/autoplay", autoplayResponseSchema);
}
