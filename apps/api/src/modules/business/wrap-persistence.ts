import { ResultAsync } from "neverthrow";
import type { PersistenceFailedError } from "./business.errors";

/**
 * Every use-case in this module wraps a repository promise the same way —
 * one shape for "the store threw", so a switch over any of this module's
 * error unions only ever sees one `persistence_failed` case rather than a
 * different one per use-case.
 */
export function wrapPersistence<T>(promise: Promise<T>): ResultAsync<T, PersistenceFailedError> {
  return ResultAsync.fromPromise(promise, (cause): PersistenceFailedError => ({
    type: "persistence_failed",
    cause: String(cause),
  }));
}
