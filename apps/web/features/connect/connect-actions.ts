"use server";

import * as z from "zod";
import { interactionRedirectSchema } from "@yourtal/contracts/oidc/interaction";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";
import { logoutResponseSchema } from "@/lib/api/auth-schema";
import { clearSessionCookie } from "@/lib/api/session-cookies";
import { interactionFetch } from "./connect-api";
import { isNavigableRedirect } from "./connect-redirect";
import { isInteractionUid } from "./connect-uid";

/**
 * Server Actions for `/connect/[uid]` (docs/26 §1.1). Each returns what the
 * browser does next, and the client does it: a full navigation to
 * `redirectTo`, or a refresh of the page, which then shows whatever the
 * sign-in has become (the ended page after a 404, the refusal after a 403,
 * the sign-in screen after a 401, the consent screen after a 409).
 */
export type ConnectActionResult =
  | { readonly kind: "redirect"; readonly redirectTo: string }
  | { readonly kind: "reload" }
  | { readonly kind: "error" };

function outcomeOf(error: ApiError): ConnectActionResult {
  if (error.kind !== "http") return { kind: "error" };
  switch (error.status) {
    case 401:
    case 403:
    case 404:
    case 409:
      return { kind: "reload" };
    default:
      return { kind: "error" };
  }
}

async function continueWith(
  uid: string,
  screen: "consent" | "continue",
): Promise<ConnectActionResult> {
  if (!isInteractionUid(uid)) return { kind: "error" };
  const result = await interactionFetch(uid, "/continue", interactionRedirectSchema, {
    method: "POST",
    body: { screen },
  });
  if (!result.ok) return outcomeOf(result.error);
  if (!isNavigableRedirect(result.data.redirectTo)) return { kind: "error" };
  return { kind: "redirect", redirectTo: result.data.redirectTo };
}

/**
 * `POST /api/connect/{uid}/continue` from the consent screen's Continue. The API
 * cannot tell which screen the person saw, so the screen is fixed here, one
 * action per screen, and is never an argument the browser supplies.
 */
export async function consentContinueAction(uid: string): Promise<ConnectActionResult> {
  return continueWith(uid, "consent");
}

/** `POST /api/connect/{uid}/continue` from the one-tap "Continue as" screen's Continue. */
export async function oneTapContinueAction(uid: string): Promise<ConnectActionResult> {
  return continueWith(uid, "continue");
}

/** `POST /api/connect/{uid}/cancel`: sends the person back to the app with a refusal. */
export async function cancelAction(uid: string): Promise<ConnectActionResult> {
  if (!isInteractionUid(uid)) return { kind: "error" };
  const result = await interactionFetch(uid, "/cancel", interactionRedirectSchema, {
    method: "POST",
    body: {},
  });
  if (!result.ok) return outcomeOf(result.error);
  if (!isNavigableRedirect(result.data.redirectTo)) return { kind: "error" };
  return { kind: "redirect", redirectTo: result.data.redirectTo };
}

/**
 * "Not you? Use another account": ends the YourTal session (clearing the
 * cookie even if the API call fails, as `logoutAction` does) and reloads
 * this page, which then shows the sign-in screen.
 */
export async function switchAccountAction(): Promise<ConnectActionResult> {
  await apiFetch("/api/auth/logout", logoutResponseSchema, { method: "POST" });
  await clearSessionCookie();
  return { kind: "reload" };
}

export type ResendResult =
  | { readonly kind: "sent" }
  | { readonly kind: "throttled" }
  | { readonly kind: "reload" }
  | { readonly kind: "error" };

const requestedSchema = z.object({ requested: z.boolean() });

/** `POST /api/auth/email/verify/request`: another link to the signed-in account's email. */
export async function resendVerificationAction(): Promise<ResendResult> {
  const result = await apiFetch("/api/auth/email/verify/request", requestedSchema, {
    method: "POST",
  });
  if (result.ok) return { kind: "sent" };
  if (result.error.kind === "http") {
    if (result.error.status === 429) return { kind: "throttled" };
    if (result.error.status === 401) return { kind: "reload" };
  }
  return { kind: "error" };
}
