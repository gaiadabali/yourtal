import "server-only";
import { apiFetch } from "@/lib/api/api-fetch";
import { apiInternalUrl } from "@/lib/api/env";
import { OPTOUT_DOMAIN, OPTOUT_SIG, optoutStatusSchema } from "./spambank-staff-contract";

export type OptoutState = "ready" | "done" | "invalid" | "unavailable";

/** True when both link parts have the shape T7 signs, so nothing odd is ever sent to the API or echoed. */
export function optoutLinkWellFormed(domain: string, sig: string): boolean {
  return OPTOUT_DOMAIN.test(domain) && OPTOUT_SIG.test(sig);
}

/**
 * Reads whether a signed opt-out link is good and already used. Read-only:
 * a GET never opts anyone out, so a link scanner opening it changes nothing
 * (BUILD.md 4.6). Uses `GET /api/spambank/optout/:domain/:sig`, which T7 adds.
 */
export async function readOptoutState(domain: string, sig: string): Promise<OptoutState> {
  if (!optoutLinkWellFormed(domain, sig)) return "invalid";
  const result = await apiFetch(
    `/api/spambank/optout/${encodeURIComponent(domain)}/${encodeURIComponent(sig)}`,
    optoutStatusSchema,
    { anonymous: true },
  );
  if (result.ok) return result.data.optedOut ? "done" : "ready";
  if (result.error.kind === "http" && [400, 403, 404].includes(result.error.status)) {
    return "invalid";
  }
  return "unavailable";
}

export type OptoutOutcome = "done" | "invalid" | "unavailable";

/**
 * Presses the button: the same `POST /api/spambank/optout/:domain/:sig` the
 * List-Unsubscribe header points at (RFC 8058 body), so there is one code
 * path on the API. Anonymous: the signature is the credential.
 */
export async function submitOptout(domain: string, sig: string): Promise<OptoutOutcome> {
  if (!optoutLinkWellFormed(domain, sig)) return "invalid";
  let response: Response;
  try {
    response = await fetch(
      `${apiInternalUrl()}/api/spambank/optout/${encodeURIComponent(domain)}/${encodeURIComponent(sig)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
        redirect: "error",
        cache: "no-store",
      },
    );
  } catch {
    return "unavailable";
  }
  if (response.ok) return "done";
  if ([400, 403, 404].includes(response.status)) return "invalid";
  return "unavailable";
}
