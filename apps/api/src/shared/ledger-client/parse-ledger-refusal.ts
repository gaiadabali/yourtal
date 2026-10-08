import {
  ledgerError,
  ledgerErrorCodeSchema,
} from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";

/**
 * Reads a non-2xx ledger answer as a refusal, or returns null when it is not
 * one (a missing thing, an outage: the caller throws).
 *
 * The Go ledger answers a refusal in two shapes (services/ledger/internal/api
 * routes.go `fail`):
 *   - a contract code, as 409 with a flat `{code, message}`;
 *   - everything else it has judged the caller's fault, as 400 with the
 *     httpx envelope `{error: {type, code: "refused", message}}`.
 * The client used to read only the flat shape, so every 400 (a points
 * mismatch, a bad attestation, a campaign no longer live) rejected and
 * surfaced as a 500. A code this enum does not know, on a status that means
 * "refused" (400, 409, 422), becomes the closed `refused` code rather than a
 * crash. 404 and 5xx stay failures. 13.3.j.
 */
export function parseLedgerRefusal(status: number, problem: unknown): LedgerError | null {
  const body = asRecord(problem);
  const nested = asRecord(body["error"]);
  const fields = Object.keys(nested).length > 0 ? nested : body;
  const message = typeof fields["message"] === "string" ? fields["message"] : "";

  const code = ledgerErrorCodeSchema.safeParse(fields["code"]);
  if (code.success) return ledgerError(code.data, message === "" ? code.data : message);

  if (status === 400 || status === 409 || status === 422) {
    return ledgerError("refused", message === "" ? "refused" : message);
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
