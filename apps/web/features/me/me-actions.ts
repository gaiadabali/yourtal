"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";
import { meResponseSchema } from "@/lib/api/me-schema";
import { clearSessionCookie, setSessionCookies, setThemeCookie } from "@/lib/api/session-cookies";
import { themeResponseSchema } from "@yourtal/contracts/me/theme-setting";
import type { ThemeResponse, ThemeSetting } from "@yourtal/contracts/me/theme-setting";
import {
  autoplayResponseSchema,
  consentsResponseSchema,
  dataExportResponseSchema,
  interestsResponseSchema,
  linkCodeResponseSchema,
  notificationPreferencesResponseSchema,
} from "./me-schemas";
import type {
  AutoplayResponse,
  ConsentsResponse,
  DataExportResponse,
  InterestsResponse,
  LinkCodeResponse,
  NotificationPreferencesResponse,
} from "./me-schemas";

/**
 * Mutations for the Me page's own widgets (6.7.a). Each returns the
 * `ApiResult` `apiFetch` already produces, plainly, rather than redirecting
 * with `?error=code` (Area A's `lib/api/actions.ts` convention for a
 * page-level flow like login) — a settings toggle is one control among a
 * dozen on the same page, and a full navigation would lose every OTHER
 * widget's in-progress state to fix one. Client leaves call these directly
 * (not bound to a `<form action>`), read `.ok`, and render inline.
 *
 * Not in this file: display-locale (`updateMeAction`, `lib/api/actions.ts`
 * — Area A's, reused as-is) and logout (`logoutAction`, same file, reused
 * as-is).
 */

const OWN_ACCOUNT_ONLY = "settings_toggle" as const;

export async function updateConsentAction(
  purpose: "declared_interest_targeting" | "marketing_communications",
  granted: boolean,
): Promise<ApiResult<ConsentsResponse>> {
  return apiFetch("/api/me/consents", consentsResponseSchema, {
    method: "POST",
    body: { purpose, state: granted ? "granted" : "withdrawn", source: OWN_ACCOUNT_ONLY },
  });
}

export async function updateInterestsAction(
  nodeIds: readonly string[],
): Promise<ApiResult<InterestsResponse>> {
  return apiFetch("/api/me/interests", interestsResponseSchema, {
    method: "PUT",
    body: { nodeIds },
  });
}

const followingResultSchema = z.object({ following: z.boolean() });

/**
 * Only unfollow is wired up on Me — following happens from a channel page
 * (6.4.d, not built this phase); `MeFollowsSection` only ever removes an
 * entry from the list it was handed.
 */
export async function unfollowAction(
  businessId: string,
): Promise<ApiResult<{ following: boolean }>> {
  return apiFetch(`/api/me/follows/${businessId}`, followingResultSchema, { method: "DELETE" });
}

const preferenceWriteResultSchema = z.object({ category: z.string(), pushEnabled: z.boolean() });

export async function setNotificationPreferenceAction(
  category: string,
  pushEnabled: boolean,
): Promise<ApiResult<NotificationPreferencesResponse>> {
  const write = await apiFetch(
    `/api/me/notifications/preferences/${category}`,
    preferenceWriteResultSchema,
    { method: "PUT", body: { pushEnabled } },
  );
  if (!write.ok) return write;
  return apiFetch("/api/me/notifications/preferences", notificationPreferencesResponseSchema);
}

export async function setAutoplayAction(
  autoplay: "always" | "wifi_only" | "never",
): Promise<ApiResult<AutoplayResponse>> {
  return apiFetch("/api/me/settings/autoplay", autoplayResponseSchema, {
    method: "PUT",
    body: { autoplay },
  });
}

/** 13.16.a: saves the theme to the account, then the cookie the server renders from. */
export async function setThemeAction(theme: ThemeSetting): Promise<ApiResult<ThemeResponse>> {
  const result = await apiFetch("/api/me/settings/theme", themeResponseSchema, {
    method: "PUT",
    body: { theme },
  });
  if (result.ok) await setThemeCookie(result.data.theme);
  return result;
}

/**
 * Wraps `POST /api/auth/password/change`. On success that route revokes
 * EVERY session for this account, including the one authenticating this
 * very call (auth.controller.ts's own doc comment), and returns a fresh
 * token — so this action re-fetches `GET /api/me` with that new token and
 * refreshes `yt_session`/`yt_region`/`yt_locale` immediately, or the very
 * next request on this browser would 401 against a cookie the server just
 * revoked.
 */
const changePasswordResultSchema = z.object({ token: z.string() });

export async function changePasswordAction(
  currentPassword: string,
  newPassword: string,
): Promise<ApiResult<{ changed: true }>> {
  const result = await apiFetch("/api/auth/password/change", changePasswordResultSchema, {
    method: "POST",
    body: { currentPassword, newPassword },
  });
  if (!result.ok) return result;

  const me = await apiFetch("/api/me", meResponseSchema, {
    headers: { authorization: `Bearer ${result.data.token}` },
  });
  if (!me.ok) return me;

  await setSessionCookies({
    token: result.data.token,
    region: me.data.profile.region,
    displayLocale: me.data.profile.displayLocale,
  });
  return { ok: true, data: { changed: true } };
}

export async function issueLinkCodeAction(): Promise<ApiResult<LinkCodeResponse>> {
  return apiFetch("/api/me/linked-apps/code", linkCodeResponseSchema, { method: "POST" });
}

export async function fetchDataExportAction(): Promise<ApiResult<DataExportResponse>> {
  return apiFetch("/api/me/data-export", dataExportResponseSchema);
}

/**
 * `DELETE /api/me` (5.4.b's real DSAR deletion, not the old fake's
 * "clears local settings"). Ends every session server-side, so the local
 * cookie is cleared too and the caller is redirected to `/login` the same
 * way `logoutAction` does — there is nothing left to sign back into.
 */
export async function deleteAccountAction(): Promise<void> {
  await apiFetch("/api/me", z.unknown(), { method: "DELETE" });
  await clearSessionCookie();
  redirect("/login");
}
