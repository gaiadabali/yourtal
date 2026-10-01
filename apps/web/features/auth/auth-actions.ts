"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";
import { loginResponseSchema } from "@/lib/api/auth-schema";
import { meResponseSchema } from "@/lib/api/me-schema";
import { setSessionCookies } from "@/lib/api/session-cookies";
import { parseReturnTo, withReturnTo } from "@/features/onboarding/onboarding-return-to";
import {
  emailVerificationConfirmedSchema,
  passwordResetConfirmedSchema,
  requestPasswordResetResponseSchema,
} from "./auth-schemas";

/**
 * Server Actions for the (auth) screens this feature owns — register,
 * forgot and reset password, and confirm email (6.2.a). `login`/`logout`
 * already exist in Area A's `lib/api/actions.ts` and are reused as-is
 * (`login/page.tsx` binds `loginAction` directly); this file only adds
 * what that one does not.
 *
 * Same zero-client-JS shape throughout: every action is a plain
 * `<form action={...}>` target, and every failure redirects back to the
 * calling page with `?error=<code>` (`errorCode`, mirroring
 * `lib/api/actions.ts`'s own convention) rather than a client-side fetch.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function errorCode(error: ApiError): string {
  return error.kind === "http" ? error.code : error.kind;
}

function redirectTo(path: string, params: Record<string, string>): never {
  const search = new URLSearchParams(params).toString();
  redirect((search ? `${path}?${search}` : path) as Route);
}

/** Carries `returnTo` back onto a failure redirect, same as it arrived — never re-validated here, since it is re-parsed by `parseReturnTo` the next time the page renders it into a hidden field. */
function paramsWithReturnTo(rawReturnTo: string, code: string): Record<string, string> {
  const params: Record<string, string> = { error: code };
  if (rawReturnTo !== "") params["returnTo"] = rawReturnTo;
  return params;
}

/**
 * `POST /api/auth/register` (1.4.c), then the same "sign the account in
 * immediately" shape `loginAction` uses — a fresh registration already has
 * a usable `{ token }`, so asking the person to type the password they
 * just chose a second time would be a pointless extra step. `guardianEmail`
 * is only ever sent when the form actually rendered the field (13-17 under
 * `TEEN_ACCOUNTS`): an empty string would otherwise fail `registerSchema`'s
 * `z.email()` check for every adult registering.
 *
 * On success, redirects to `/onboarding?returnTo=…` — the one hand-off
 * onboarding's own screens (6.2.b) read.
 */
export async function registerAction(formData: FormData): Promise<void> {
  const rawReturnTo = stringField(formData, "returnTo");
  const returnTo = parseReturnTo(rawReturnTo);

  const guardianEmail = stringField(formData, "guardianEmail");
  const body: Record<string, unknown> = {
    email: stringField(formData, "email"),
    password: stringField(formData, "password"),
    displayName: stringField(formData, "displayName"),
    region: stringField(formData, "region"),
    locale: stringField(formData, "locale"),
    dateOfBirth: stringField(formData, "dateOfBirth"),
    timezone: stringField(formData, "timezone") || "Australia/Sydney",
    ...(guardianEmail === "" ? {} : { guardianEmail }),
  };

  const result = await apiFetch("/api/auth/register", loginResponseSchema, {
    method: "POST",
    // `@Idempotent` on `POST /api/auth/register` requires this header — a
    // fresh key per submission, since a genuine retry (the person clicking
    // submit twice) reaching the SAME key is exactly what `withoutToken`'s
    // redacted replay is for; this action has no earlier attempt to key
    // against, so a new one every call is correct, not a workaround.
    headers: { "idempotency-key": randomUUID() },
    body,
  });
  if (!result.ok) {
    redirectTo("/register", paramsWithReturnTo(rawReturnTo, errorCode(result.error)));
  }

  const meResult = await apiFetch("/api/me", meResponseSchema, {
    headers: { authorization: `Bearer ${result.data.token}` },
  });
  if (!meResult.ok) {
    redirectTo("/register", paramsWithReturnTo(rawReturnTo, "profile_unavailable"));
  }

  await setSessionCookies({
    token: result.data.token,
    region: meResult.data.profile.region,
    displayLocale: meResult.data.profile.displayLocale,
  });

  // A sign-up that started at onboarding (an Open View or campaign link) already
  // carries its own returnTo; wrapping it again would nest onboarding in itself.
  const next = returnTo?.startsWith("/onboarding") ? returnTo : withReturnTo("/onboarding", returnTo);
  redirect(next as Route);
}

/**
 * `POST /api/auth/password/reset/request` (1.4.f) ALWAYS reports success —
 * see `auth.errors.ts`'s own doc comment on why this endpoint never
 * distinguishes "no such account" from "email sent". This action mirrors
 * that: the only failure it can surface back to the form is a plumbing one
 * (`network`, `persistence_unavailable`), never "that email isn't
 * registered".
 */
export async function forgotPasswordAction(formData: FormData): Promise<void> {
  const email = stringField(formData, "email");
  const result = await apiFetch(
    "/api/auth/password/reset/request",
    requestPasswordResetResponseSchema,
    { method: "POST", body: { email } },
  );
  if (!result.ok) {
    redirectTo("/forgot", { error: errorCode(result.error) });
  }
  redirectTo("/forgot", { sent: "1" });
}

/**
 * `POST /api/auth/password/reset/confirm` (1.4.f) also mints a fresh
 * session, so a successful reset signs the person straight in — the same
 * "as privilege-relevant as a password change" reasoning `AuthService`'s
 * own doc comment gives for reissuing a token here. A missing token (a
 * reset link opened with its query string stripped) never reaches the API
 * at all; the page itself renders a plain notice for that case.
 */
export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = stringField(formData, "token");
  const newPassword = stringField(formData, "newPassword");

  const result = await apiFetch("/api/auth/password/reset/confirm", passwordResetConfirmedSchema, {
    method: "POST",
    body: { token, newPassword },
  });
  if (!result.ok) {
    redirectTo("/reset", { token, error: errorCode(result.error) });
  }

  const meResult = await apiFetch("/api/me", meResponseSchema, {
    headers: { authorization: `Bearer ${result.data.token}` },
  });
  if (!meResult.ok) {
    redirect("/login");
  }

  await setSessionCookies({
    token: result.data.token,
    region: meResult.data.profile.region,
    displayLocale: meResult.data.profile.displayLocale,
  });
  // "/" is now a real page (11.1.a's landing page), so typedRoutes' own
  // generated `Route` union includes it literally — the cast every other
  // redirect() call here still needs is redundant for this one exact
  // literal (F46's own precedent: drop the cast, no behaviour change).
  redirect("/");
}

/**
 * `POST /api/auth/email/verify/confirm` (1.4.e). Deliberately gated behind
 * a button the person clicks, not a side effect of loading `/verify` — the
 * token is single-use, and an email client or scanner that prefetches the
 * link's URL would otherwise burn it before the person ever sees the page.
 */
export async function verifyEmailAction(formData: FormData): Promise<void> {
  const token = stringField(formData, "token");
  const result = await apiFetch(
    "/api/auth/email/verify/confirm",
    emailVerificationConfirmedSchema,
    // `@Idempotent` on this route requires the header too — see
    // `registerAction`'s own comment on why a fresh key per click is
    // correct here rather than a workaround.
    { method: "POST", headers: { "idempotency-key": randomUUID() }, body: { token } },
  );
  if (!result.ok) {
    redirectTo("/verify", { token, error: errorCode(result.error) });
  }
  redirectTo("/verify", { token, verified: "1" });
}
