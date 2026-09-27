import { ResultAsync } from "neverthrow";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerRefusedError, PersistenceFailedError } from "./billing.errors";

/** Every use-case in this module wraps a repository promise the same way -- mirrors `store/wrap-persistence.ts`. */
export function wrapPersistence<T>(promise: Promise<T>): ResultAsync<T, PersistenceFailedError> {
  return ResultAsync.fromPromise(promise, (cause): PersistenceFailedError => ({
    type: "persistence_failed",
    cause: String(cause),
  }));
}

/** `LedgerInternalClient` methods already return a `Result` -- this only reshapes the error side. */
export function wrapLedgerCall<T>(
  result: ResultAsync<T, LedgerError>,
): ResultAsync<T, LedgerRefusedError> {
  return result.mapErr(
    (error): LedgerRefusedError => ({ type: "ledger_refused", code: error.code, message: error.message }),
  );
}
