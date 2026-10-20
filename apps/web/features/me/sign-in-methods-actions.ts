"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import {
  passkeyCeremonySchema,
  passkeySummarySchema,
  totpEnrolmentSchema,
  webAuthnOptionsSchema,
} from "@yourtal/contracts/identity/sign-in-methods";
import type {
  PasskeyCeremony,
  PasskeySummary,
  TotpEnrolment,
} from "@yourtal/contracts/identity/sign-in-methods";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";
import { logoutResponseSchema } from "@/lib/api/auth-schema";
import { clearSessionCookie } from "@/lib/api/session-cookies";

/**
 * Mutations for Me → security's passkeys and authenticator app (and the
 * passkey offer after sign-in). Same shape as `me-actions.ts`: each returns
 * the `ApiResult`, and the client shows it inline. A browser's WebAuthn
 * answer is passed through as it came and checked by the API, which is the
 * authority; nothing here keeps or logs the authenticator seed.
 */

const optionsOnlySchema = z.object({ options: webAuthnOptionsSchema });

export async function registerPasskeyOptionsAction(): Promise<
  ApiResult<{ options: Record<string, unknown> }>
> {
  return apiFetch("/api/auth/passkeys/register/options", optionsOnlySchema, { method: "POST" });
}

/** `name` is optional: left out, the API names the passkey itself. */
export async function registerPasskeyAction(
  response: unknown,
  name?: string,
): Promise<ApiResult<PasskeySummary>> {
  const trimmed = name?.trim();
  return apiFetch("/api/auth/passkeys/register", passkeySummarySchema, {
    method: "POST",
    body: trimmed ? { response, name: trimmed } : { response },
  });
}

export async function removePasskeyAction(id: string): Promise<ApiResult<{ removed: boolean }>> {
  return apiFetch(
    `/api/auth/passkeys/${encodeURIComponent(id)}`,
    z.object({ removed: z.boolean() }),
    { method: "DELETE" },
  );
}

/** A challenge over the account's own passkeys, to prove it is them before turning a protection off. */
export async function passkeyStepUpOptionsAction(): Promise<ApiResult<PasskeyCeremony>> {
  return apiFetch("/api/auth/passkeys/step-up/options", passkeyCeremonySchema, { method: "POST" });
}

export async function startTotpEnrolmentAction(): Promise<ApiResult<TotpEnrolment>> {
  return apiFetch("/api/auth/totp/enrol", totpEnrolmentSchema, { method: "POST" });
}

export async function confirmTotpAction(code: string): Promise<ApiResult<{ enabled: boolean }>> {
  return apiFetch("/api/auth/totp/confirm", z.object({ enabled: z.boolean() }), {
    method: "POST",
    body: { code },
  });
}

const disabledSchema = z.object({ enabled: z.boolean() });

export async function disableTotpWithCodeAction(
  code: string,
): Promise<ApiResult<{ enabled: boolean }>> {
  return apiFetch("/api/auth/totp/disable", disabledSchema, { method: "POST", body: { code } });
}

export async function disableTotpWithPasskeyAction(
  challengeId: string,
  response: unknown,
): Promise<ApiResult<{ enabled: boolean }>> {
  return apiFetch("/api/auth/totp/disable", disabledSchema, {
    method: "POST",
    body: { challengeId, response },
  });
}

/** Same as `logoutAction`, but lands back on `/login` heading for Me, for a change that wants a recent sign-in. */
export async function signInAgainAction(): Promise<void> {
  await apiFetch("/api/auth/logout", logoutResponseSchema, { method: "POST" });
  await clearSessionCookie();
  redirect("/login?returnTo=%2Fme");
}
