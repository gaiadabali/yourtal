import "server-only";

import type { z } from "zod";
import { apiInternalUrl } from "./env";
import { httpErrorFrom, networkErrorMessage, tryParseJson } from "./api-fetch";
import type { ApiResult } from "./api-fetch";

export interface PublicApiFetchInit {
  /** Query string params appended to `path`. */
  searchParams?: Record<string, string>;
  /**
   * ISR revalidation window in seconds — Next's own fetch cache, not
   * `apiFetch`'s always-fresh `cache: "no-store"`. This is what lets `/au`
   * and `/id` (11.2.a) stay statically generated and revalidate on a timer
   * instead of opting into dynamic rendering.
   */
  revalidate: number;
}

/**
 * 11.2.a: the public tree's own way to read `apps/api` — `apiFetch` always
 * calls `readSessionToken()` (`next/headers`' `cookies()`), which opts a
 * route into dynamic rendering the instant it runs, and always sets
 * `cache: "no-store"`, wrong for a page that must stay statically
 * generated and indexable (docs/11-seo-aeo-geo.md §1). This sibling never
 * imports `next/headers` and never sends a session — every call here is
 * anonymous by construction, matching the feed/campaign endpoints it talks
 * to (`@PublicRoute`/Open Viewing's anonymous role), and asks Next's own
 * fetch cache to revalidate on a timer instead.
 *
 * Shares `apiFetch`'s JSON parsing and error mapping (`httpErrorFrom`,
 * `tryParseJson`, `networkErrorMessage`) so the two never drift on what an
 * `ApiError` looks like.
 */
export async function publicApiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init: PublicApiFetchInit,
): Promise<ApiResult<T>> {
  const url = new URL(`${apiInternalUrl()}${path}`);
  for (const [key, value] of Object.entries(init.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate: init.revalidate },
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
