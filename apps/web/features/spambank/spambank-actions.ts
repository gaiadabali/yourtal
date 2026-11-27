"use server";

import * as z from "zod";
import { mailSessionSchema } from "@yourtal/contracts/spambank/common";
import type { MailSession } from "@yourtal/contracts/spambank/common";
import {
  appPasswordCreatedSchema,
  appPasswordListSchema,
  enableMailboxResultSchema,
} from "@yourtal/contracts/spambank/management";
import type {
  AppPasswordCreated,
  AppPasswordList,
  EnableMailboxResult,
} from "@yourtal/contracts/spambank/management";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";

/**
 * Server Actions for the person's own mailbox (spambank/BUILD.md section 5.1). Each returns the
 * `ApiResult` plainly, like `me-actions.ts`: a client leaf reads `.ok` and words the failure itself.
 * The mail itself never comes through here; the browser talks to the proxy with the token below.
 */

/** Mints a 30-minute mail token. The engine calls this when it needs one, and again before expiry. */
export async function mintMailSessionAction(): Promise<ApiResult<MailSession>> {
  return apiFetch("/api/spambank/me/session", mailSessionSchema, { method: "POST" });
}

/** Switches mail on: `201` for a new address, `200` when there already is one. */
export async function enableMailboxAction(): Promise<ApiResult<EnableMailboxResult>> {
  return apiFetch("/api/spambank/me/enable", enableMailboxResultSchema, { method: "POST" });
}

export async function listAppPasswordsAction(): Promise<ApiResult<AppPasswordList>> {
  return apiFetch("/api/spambank/me/app-passwords", appPasswordListSchema);
}

/** The reply carries the secret once; nothing returns it again. */
export async function createAppPasswordAction(
  name: string,
): Promise<ApiResult<AppPasswordCreated>> {
  return apiFetch("/api/spambank/me/app-passwords", appPasswordCreatedSchema, {
    method: "POST",
    body: { name },
  });
}

export async function revokeAppPasswordAction(id: string): Promise<ApiResult<undefined>> {
  return apiFetch(`/api/spambank/me/app-passwords/${encodeURIComponent(id)}`, z.undefined(), {
    method: "DELETE",
  });
}

/** `202`: the mailbox is erased within minutes and its name retired. */
export async function deleteMailboxAction(): Promise<ApiResult<undefined>> {
  return apiFetch("/api/spambank/me", z.undefined(), { method: "DELETE" });
}
