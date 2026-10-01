import "server-only";
import { forwardViewerAddress } from "@/lib/api/viewer-address";

import type { z } from "zod";
import {
  guardianConsentViewSchema,
  approveGuardianConsentResultSchema,
  revokeGuardianConsentResultSchema,
  deleteGuardianAccountResultSchema,
} from "@yourtal/contracts/identity/guardian";
import type {
  GuardianConsentView,
  ApproveGuardianConsentResult,
  RevokeGuardianConsentResult,
  DeleteGuardianAccountResult,
} from "@yourtal/contracts/identity/guardian";
import { apiInternalUrl } from "@/lib/api/env";
import { httpErrorFrom, networkErrorMessage, tryParseJson } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";

/**
 * 12.2.c's own fetch to `GET/POST /api/guardian/:token[/approve|/revoke]`
 * (12.1.a). Deliberately its own file, not `apiFetch`/`publicApiFetch`:
 * neither fits. `apiFetch` always reads the `yt_session` cookie via
 * `next/headers`, and this page must not read cookies at all — there is no
 * session, the token itself is the whole credential (the controller's own
 * doc comment). `publicApiFetch` never reads a cookie either, but it is
 * GET/ISR-shaped (`revalidate`, no request body) — approve/revoke are
 * mutating POSTs that need an `Idempotency-Key` header, which that helper
 * has no room for. Reuses `apiFetch`'s JSON parsing and error mapping
 * (`httpErrorFrom`/`tryParseJson`/`networkErrorMessage`, both already
 * exported for exactly this "second caller, same shapes" reason) so a
 * guardian-facing error and a signed-in one never drift on what an
 * `ApiError` looks like.
 */

async function guardianFetch(
  path: string,
  init: RequestInit,
): Promise<Response | ApiResult<never>> {
  // `new Headers(init.headers)`, not an object spread: `init.headers` is
  // `HeadersInit`, which can be a `Headers` instance or a tuple array as
  // well as a plain object, and spreading either of those into an object
  // literal silently drops or mis-copies entries (`apiFetch`'s own header
  // construction avoids the same trap the same way).
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  await forwardViewerAddress(headers);
  // `apiInternalUrl()` OUTSIDE the try, same as `apiFetch`'s own header
  // comment on this: a missing `API_INTERNAL_URL` is a boot-time
  // misconfiguration, not a request-time network failure, and should throw
  // rather than be swallowed into a generic "network" `ApiError` a caller
  // would render as an ordinary connectivity blip.
  const url = `${apiInternalUrl()}${path}`;
  try {
    return await fetch(url, { ...init, headers, cache: "no-store" });
  } catch (cause) {
    return { ok: false, error: { kind: "network", message: networkErrorMessage(cause) } };
  }
}

function isResponse(value: Response | ApiResult<never>): value is Response {
  return value instanceof Response;
}

async function parseAgainst<T>(
  response: Response,
  schema: z.ZodType<T>,
  path: string,
): Promise<ApiResult<T>> {
  const rawText = await response.text();
  const rawBody: unknown = rawText.length > 0 ? tryParseJson(rawText) : undefined;

  if (!response.ok) {
    return { ok: false, error: httpErrorFrom(response.status, rawBody) };
  }
  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        kind: "invalid_response",
        message: `response from ${path} did not match its contract: ${parsed.error.message}`,
      },
    };
  }
  return { ok: true, data: parsed.data };
}

/** `GET /api/guardian/:token`. A 404 arrives as an `ApiError` of `kind: "http"`, `code: "not_found"` — the page maps that one case to its own "invalid link" state. */
export async function getGuardianConsent(token: string): Promise<ApiResult<GuardianConsentView>> {
  const path = `/api/guardian/${encodeURIComponent(token)}`;
  const result = await guardianFetch(path, { method: "GET" });
  if (!isResponse(result)) return result;
  return parseAgainst(result, guardianConsentViewSchema, path);
}

/** `POST /api/guardian/:token/approve`. `confirmAdult` is always the literal `true` — the checkbox that gates this call IS that confirmation; there is no other value this ever sends. */
export async function approveGuardianConsent(
  token: string,
  idempotencyKey: string,
): Promise<ApiResult<ApproveGuardianConsentResult>> {
  const path = `/api/guardian/${encodeURIComponent(token)}/approve`;
  const result = await guardianFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ confirmAdult: true }),
  });
  if (!isResponse(result)) return result;
  return parseAgainst(result, approveGuardianConsentResultSchema, path);
}

/** `POST /api/guardian/:token/revoke`. No body — the token alone identifies which link is withdrawing. */
export async function revokeGuardianConsent(
  token: string,
  idempotencyKey: string,
): Promise<ApiResult<RevokeGuardianConsentResult>> {
  const path = `/api/guardian/${encodeURIComponent(token)}/revoke`;
  const result = await guardianFetch(path, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
  });
  if (!isResponse(result)) return result;
  return parseAgainst(result, revokeGuardianConsentResultSchema, path);
}

/** `POST /api/guardian/:token/delete-account` (12.4.b #6). `confirm` is always the literal `true` — the confirm dialog gating this call IS that confirmation. */
export async function deleteGuardianAccount(
  token: string,
  idempotencyKey: string,
): Promise<ApiResult<DeleteGuardianAccountResult>> {
  const path = `/api/guardian/${encodeURIComponent(token)}/delete-account`;
  const result = await guardianFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ confirm: true }),
  });
  if (!isResponse(result)) return result;
  return parseAgainst(result, deleteGuardianAccountResultSchema, path);
}
