import type { ApiError } from "@/lib/api/api-fetch";

/**
 * Maps an `ApiError` from `guardian-api.ts` to one of the `errors.*` keys
 * every state's own catalogue namespace carries (`pending.errors`,
 * `granted.errors`) — same "one key per case, `unknown` as the floor"
 * shape `auth.json`'s own `errors` blocks already use. `not_found` is
 * deliberately absent: that case is handled once, at the page level (the
 * "invalid link" state), not re-surfaced as an action error here.
 */
export type GuardianErrorKey =
  "already_revoked" | "network" | "invalid_response" | "unavailable" | "unknown";

export function guardianErrorKeyFor(error: ApiError): GuardianErrorKey {
  if (error.kind === "network") return "network";
  if (error.kind === "invalid_response") return "invalid_response";
  if (error.code === "already_revoked") return "already_revoked";
  if (error.code === "ledger_unavailable" || error.status >= 500) return "unavailable";
  return "unknown";
}
