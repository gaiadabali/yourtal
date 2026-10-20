"use client";

import { useSyncExternalStore } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { ApiResult } from "@/lib/api/api-fetch";

/**
 * The browser half of a passkey ceremony, shared by sign-in, the passkey
 * offer and Me → security: ask the server for options, let the browser talk
 * to the authenticator, and hand back either its answer or ONE error code the
 * caller maps to copy. Server calls are passed in, since each screen has its
 * own (sign-in, register, step-up).
 */

const subscribeToNothing = () => () => undefined;

/** False on the server and on the first client render, so hydration agrees; then the browser's real answer. */
export function useBrowserSupportsWebAuthn(): boolean {
  return useSyncExternalStore(subscribeToNothing, browserSupportsWebAuthn, () => false);
}

/** After the browser step, the API turns a bad assertion into `factor_invalid`, which reads as a code error elsewhere. */
export function passkeyApiCode(code: string): string {
  return code === "factor_invalid" ? "passkey_failed" : code;
}

export type CeremonyResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly code: string };

interface BrowserError {
  name?: string;
  code?: string;
  cause?: { name?: string };
}

/** The person closed the prompt or let it time out: not a fault worth alarming them about. */
function failureCode(error: unknown): string {
  const failure = (typeof error === "object" && error !== null ? error : {}) as BrowserError;
  if (failure.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return "passkey_already_registered";
  }
  const names = [failure.name, failure.cause?.name];
  if (
    failure.code === "ERROR_CEREMONY_ABORTED" ||
    names.includes("NotAllowedError") ||
    names.includes("AbortError")
  ) {
    return "passkey_cancelled";
  }
  return "passkey_failed";
}

function apiCode(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  return result.error.kind === "http" ? result.error.code : result.error.kind;
}

export async function runAuthentication(
  fetchOptions: () => Promise<ApiResult<{ challengeId: string; options: Record<string, unknown> }>>,
): Promise<CeremonyResult<{ challengeId: string; response: AuthenticationResponseJSON }>> {
  const ceremony = await fetchOptions();
  if (!ceremony.ok) return { ok: false, code: apiCode(ceremony) };
  try {
    const response = await startAuthentication({
      optionsJSON: ceremony.data.options as unknown as PublicKeyCredentialRequestOptionsJSON,
    });
    return { ok: true, data: { challengeId: ceremony.data.challengeId, response } };
  } catch (error) {
    return { ok: false, code: failureCode(error) };
  }
}

export async function runRegistration(
  fetchOptions: () => Promise<ApiResult<{ options: Record<string, unknown> }>>,
): Promise<CeremonyResult<{ response: RegistrationResponseJSON }>> {
  const ceremony = await fetchOptions();
  if (!ceremony.ok) return { ok: false, code: apiCode(ceremony) };
  try {
    const response = await startRegistration({
      optionsJSON: ceremony.data.options as unknown as PublicKeyCredentialCreationOptionsJSON,
    });
    return { ok: true, data: { response } };
  } catch (error) {
    return { ok: false, code: failureCode(error) };
  }
}
