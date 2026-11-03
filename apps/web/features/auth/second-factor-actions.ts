"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { passkeyCeremonySchema, signedInSchema } from "@yourtal/contracts/identity/sign-in-methods";
import type { PasskeyCeremony } from "@yourtal/contracts/identity/sign-in-methods";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError, ApiResult } from "@/lib/api/api-fetch";
import { finishSignIn } from "@/lib/api/finish-sign-in";
import { clearMfaPendingCookie, readMfaPendingToken } from "@/lib/api/session-cookies";
import { parseReturnTo } from "@/features/onboarding/onboarding-return-to";

/**
 * The two ways to finish signing in without a password: an authenticator-app
 * code after the password step, and a passkey. Both end in the same
 * `finishSignIn` as a password sign-in. The code form is a plain
 * `<form action>` (failures redirect back with `?error=<code>`, like the other
 * (auth) screens); the passkey ceremony runs in the browser between two
 * calls, so those return a result instead of redirecting on failure.
 */

function errorCode(error: ApiError): string {
  return error.kind === "http" ? error.code : error.kind;
}

function redirectWithParams(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}` as Route);
}

/** Failure redirect that keeps where the person was going. */
function failBackTo(path: string, code: string, returnTo: string): never {
  redirectWithParams(path, returnTo === "/" ? { error: code } : { error: code, returnTo });
}

/** `POST /api/auth/totp/sign-in`: the code, plus the pending token the password step left in its cookie. */
export async function totpSignInAction(formData: FormData): Promise<void> {
  const rawReturnTo = formData.get("returnTo");
  const returnTo = parseReturnTo(typeof rawReturnTo === "string" ? rawReturnTo : undefined) ?? "/";

  const pendingToken = await readMfaPendingToken();
  if (pendingToken === null) failBackTo("/login", "second_step_expired", returnTo);

  const rawCode = formData.get("code");
  // Authenticator apps show "123 456"; a malformed code never costs an attempt.
  const code = typeof rawCode === "string" ? rawCode.replace(/\s+/g, "") : "";
  if (!/^\d{6}$/.test(code)) failBackTo("/login/code", "factor_invalid", returnTo);

  const result = await apiFetch("/api/auth/totp/sign-in", signedInSchema, {
    method: "POST",
    body: { pendingToken, code },
  });
  if (!result.ok) failBackTo("/login/code", errorCode(result.error), returnTo);

  await clearMfaPendingCookie();
  const finished = await finishSignIn({ token: result.data.token, returnTo, offerPasskey: true });
  if (!finished.ok) failBackTo("/login", finished.code, returnTo);
  redirect(finished.next as Route);
}

/** `POST /api/auth/passkeys/sign-in/options`: a challenge for the browser to sign. */
export async function passkeySignInOptionsAction(): Promise<ApiResult<PasskeyCeremony>> {
  return apiFetch("/api/auth/passkeys/sign-in/options", passkeyCeremonySchema, { method: "POST" });
}

/**
 * `POST /api/auth/passkeys/sign-in`. Success redirects (so it never returns);
 * returning at all means the sign-in did not complete.
 */
export async function passkeySignInAction(
  challengeId: string,
  response: unknown,
  rawReturnTo?: string,
): Promise<{ ok: false; code: string }> {
  const returnTo = parseReturnTo(rawReturnTo) ?? "/";
  const result = await apiFetch("/api/auth/passkeys/sign-in", signedInSchema, {
    method: "POST",
    body: { challengeId, response },
  });
  if (!result.ok) return { ok: false, code: errorCode(result.error) };

  await clearMfaPendingCookie();
  // A passkey sign-in is itself the proof, so no passkey prompt follows it.
  const finished = await finishSignIn({ token: result.data.token, returnTo, offerPasskey: false });
  if (!finished.ok) return { ok: false, code: finished.code };
  redirect(finished.next as Route);
}
