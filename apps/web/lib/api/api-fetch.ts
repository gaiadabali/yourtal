import "server-only";

import type { z } from "zod";
import { apiInternalUrl } from "./env";
import { readSessionToken } from "./session-cookies";

/**
 * Typed errors (1.7.a) — a caller always gets one of these three shapes,
 * never a bare thrown exception, so a Server Component can render "you're
 * not signed in" and "the API is down" differently without a try/catch
 * around every call.
 */
export type ApiError =
  | {
      readonly kind: "http";
      readonly status: number;
      readonly code: string;
      readonly message: string;
    }
  | { readonly kind: "network"; readonly message: string }
  | { readonly kind: "invalid_response"; readonly message: string };

export type ApiResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ApiError };

export interface ApiFetchInit extends Omit<RequestInit, "body"> {
  /** JSON-serialisable request body. `apiFetch` stringifies it and sets `content-type`. */
  body?: unknown;
}

/**
 * The one place `apps/web` talks to `apps/api` (1.7.a). Server-only: it
 * reads the `yt_session` cookie via `next/headers`, which throws outside a
 * request context (the browser, most obviously), and forwards it as
 * `Authorization: Bearer <token>` — the exact mechanism `AuthService`'s own
 * routes (`logout`, `password/change`) already read via `bearerToken()`,
 * and the second branch `PrincipalService.resolve` grows once 1.5.a lands
 * ("the `yt_session` httpOnly cookie (or Bearer token)"). A caller that
 * already has a token that has not reached a cookie yet (immediately after
 * login, before the response with `Set-Cookie` round-trips) can pass its own
 * `authorization` header in `init`, which always wins over the cookie.
 *
 * Every response body is validated against `schema` before a caller ever
 * sees it, so a route that drifts from its own contract fails loudly here
 * — as an `invalid_response` `ApiError` — rather than three components
 * downstream as `Cannot read properties of undefined`.
 *
 * `cache: "no-store"` always: every response here can depend on the
 * caller's own session, and Next's default fetch cache has no way to key on
 * a cookie it never sees (this function reads the cookie itself, not the
 * `fetch` call it makes).
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init: ApiFetchInit = {},
): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");

  if (!headers.has("authorization")) {
    const token = await readSessionToken();
    if (token !== null) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const hasBody = init.body !== undefined;
  if (hasBody && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  // Deliberately OUTSIDE the try/catch below: a missing `API_INTERNAL_URL`
  // is a boot-time misconfiguration, not a request-time network failure,
  // and should throw (see `apiInternalUrl`'s own doc comment) rather than
  // be swallowed into an `ApiError` a caller might render as "offline."
  const url = `${apiInternalUrl()}${path}`;

  // `exactOptionalPropertyTypes`: `fetch`'s `body` is `BodyInit | null`, no
  // `undefined`, so the key is only ever present when there is a body —
  // same convention as `update-me.schema.ts`'s `exactOptionalPropertyTypes`
  // comment.
  const { body: _initBody, ...restInit } = init;
  let response: Response;
  try {
    response = await fetch(url, {
      ...restInit,
      headers,
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
      cache: "no-store",
    });
  } catch (cause) {
    return { ok: false, error: { kind: "network", message: networkErrorMessage(cause) } };
  }

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

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A non-JSON error body (a proxy's plain-text 502, say) still needs a
    // message somewhere `httpErrorFrom` can find it.
    return { message: text };
  }
}

/**
 * Nest's default `HttpException(body)` sends `body` verbatim as the JSON
 * response — every domain error in this app is shaped `{ code, message }`
 * (see `apps/api/src/modules/auth/to-http-exception.ts`). A response that
 * does not follow that convention (an unhandled 500, a proxy error page)
 * still gets a usable, if generic, `ApiError`.
 */
function httpErrorFrom(status: number, body: unknown): ApiError {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const code = typeof record["code"] === "string" ? record["code"] : `http_${status}`;
  const message =
    typeof record["message"] === "string"
      ? record["message"]
      : `request failed with status ${status}`;
  return { kind: "http", status, code, message };
}

function networkErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "network error";
}
