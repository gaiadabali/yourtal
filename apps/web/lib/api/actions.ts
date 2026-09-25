"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { apiFetch } from "./api-fetch";
import type { ApiError } from "./api-fetch";
import { loginResponseSchema, logoutResponseSchema } from "./auth-schema";
import { meResponseSchema } from "./me-schema";
import { clearSessionCookie, setLocaleCookie, setSessionCookies } from "./session-cookies";

/**
 * Server Actions for identity plumbing (1.7.b), living in Area A's
 * `apps/web/lib/api/` rather than `apps/web/features/auth/**` (B-owned) —
 * a `"use server"` file only ever exports the actions themselves, never
 * markup, so a page in any area can `import { loginAction } from
 * "@/lib/api/actions"` and bind it straight to a `<form action={...}>`
 * (the same zero-client-JS shape `onboarding/commit-region-action.ts`
 * already uses). B wires this into the actual login page under 6.2.a.
 *
 * Errors are reported by redirecting back to the calling page with an
 * `?error=<code>` query param, matching `commitRegionAction`'s own
 * convention, rather than a `useActionState` return value — that keeps the
 * form itself server-renderable with no client component required. The
 * `error` codes are whatever `ApiError` produces (`errorCode` below): a
 * domain code from the API (`invalid_credentials`, `too_young`, …), or
 * `network` / `invalid_response` for a plumbing failure.
 */

function safeReturnTo(formData: FormData, fallback: string): string {
  const entry = formData.get("returnTo");
  return typeof entry === "string" && entry.startsWith("/") ? entry : fallback;
}

function errorCode(error: ApiError): string {
  return error.kind === "http" ? error.code : error.kind;
}

function redirectWithError(path: string, returnTo: string, code: string): never {
  const params = new URLSearchParams({ error: code });
  // Only carry `returnTo` when it points somewhere OTHER than this same
  // redirect target — `updateMeAction` redirects failures back to
  // `returnTo` itself, and `?returnTo=/me` on `/me` would be a no-op query
  // param, not information the retry needs.
  if (returnTo !== "/" && returnTo !== path) params.set("returnTo", returnTo);
  redirect(`${path}?${params.toString()}` as Route);
}

/**
 * Logs in, then sets `yt_session`, `yt_region` and `yt_locale` from the
 * account's OWN profile (`GET /api/me`) — never a guess the form itself
 * might make — and redirects to `returnTo` (default `/`). On any failure it
 * redirects back to `/login` with `?error=<code>` (and the original
 * `returnTo`, so the retry keeps its destination).
 */
export async function loginAction(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData, "/");

  const email = formData.get("email");
  const password = formData.get("password");
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email === "" ||
    password === ""
  ) {
    redirectWithError("/login", returnTo, "missing_credentials");
  }

  const loginResult = await apiFetch("/api/auth/login", loginResponseSchema, {
    method: "POST",
    body: { email, password },
  });
  if (!loginResult.ok) {
    redirectWithError("/login", returnTo, errorCode(loginResult.error));
  }

  // The session cookie is not set yet (that happens below), so the fresh
  // token has to be forwarded explicitly for this one call.
  const meResult = await apiFetch("/api/me", meResponseSchema, {
    headers: { authorization: `Bearer ${loginResult.data.token}` },
  });
  if (!meResult.ok) {
    redirectWithError("/login", returnTo, "profile_unavailable");
  }

  await setSessionCookies({
    token: loginResult.data.token,
    region: meResult.data.profile.region,
    displayLocale: meResult.data.profile.displayLocale,
  });

  redirect(returnTo as Route);
}

/** Idempotent: clears the local cookie even if the API call itself fails (already-expired session, network blip). */
export async function logoutAction(): Promise<void> {
  await apiFetch("/api/auth/logout", logoutResponseSchema, { method: "POST" });
  await clearSessionCookie();
  redirect("/login" as Route);
}

/**
 * `PATCH /api/me` — display name and/or locale only (region is immutable,
 * 1.4.d). Refreshes `yt_locale` from the response so the cookie always
 * matches what the account actually has, never what the form submitted (a
 * rejected value must not update the cookie).
 */
export async function updateMeAction(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData, "/me");

  const displayNameEntry = formData.get("displayName");
  const displayLocaleEntry = formData.get("displayLocale");
  const body: Record<string, string> = {};
  if (typeof displayNameEntry === "string" && displayNameEntry !== "") {
    body["displayName"] = displayNameEntry;
  }
  if (typeof displayLocaleEntry === "string" && displayLocaleEntry !== "") {
    body["displayLocale"] = displayLocaleEntry;
  }

  const result = await apiFetch("/api/me", meResponseSchema, { method: "PATCH", body });
  if (!result.ok) {
    redirectWithError(returnTo, returnTo, errorCode(result.error));
  }

  await setLocaleCookie(result.data.profile.displayLocale);
  redirect(returnTo as Route);
}
