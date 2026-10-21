import "server-only";

import { headers } from "next/headers";
import { interactionDetailsSchema } from "@yourtal/contracts/oidc/interaction";
import type { InteractionDetails } from "@yourtal/contracts/oidc/interaction";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiFetchInit, ApiResult } from "@/lib/api/api-fetch";
import type { z } from "zod";
import { interactionCookieHeader } from "./connect-cookies";

/**
 * One call to the interaction API (docs/26 §1.1), made by the web server for
 * the browser. The provider's two interaction cookies travel in a `Cookie`
 * header and nothing else from the browser's cookies does; the YourTal
 * session is added by `apiFetch`, the way every other page forwards it. None
 * of this ever reaches a client component or a URL.
 */
export async function interactionFetch<T>(
  uid: string,
  suffix: "" | "/continue" | "/cancel",
  schema: z.ZodType<T>,
  init: ApiFetchInit = {},
): Promise<ApiResult<T>> {
  const cookie = interactionCookieHeader((await headers()).get("cookie"));
  const forwarded = new Headers(init.headers);
  if (cookie !== null) forwarded.set("cookie", cookie);
  return apiFetch(`/api/connect/${encodeURIComponent(uid)}${suffix}`, schema, {
    ...init,
    headers: forwarded,
  });
}

export type LoadedInteraction =
  | { readonly kind: "ok"; readonly details: InteractionDetails }
  /** 404: the sign-in ended, or belongs to another browser. */
  | { readonly kind: "ended" }
  /** The request carried no interaction cookie at all, so nothing was asked of the API. */
  | { readonly kind: "no-cookie" }
  | { readonly kind: "unavailable" };

export async function loadInteraction(uid: string): Promise<LoadedInteraction> {
  // A server action's redirect renders this page inside the POST to /login (or /register), which
  // carries only the cookies scoped to that path. A cookie the API rejects is a 404 below; none at
  // all is a request the browser should repeat as a real GET.
  if (interactionCookieHeader((await headers()).get("cookie")) === null) {
    return { kind: "no-cookie" };
  }
  const result = await interactionFetch(uid, "", interactionDetailsSchema);
  if (result.ok) return { kind: "ok", details: result.data };
  if (result.error.kind === "http" && result.error.status === 404) return { kind: "ended" };
  return { kind: "unavailable" };
}
