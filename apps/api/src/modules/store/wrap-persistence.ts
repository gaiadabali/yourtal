import { ResultAsync } from "neverthrow";
import type { PersistenceFailedError } from "./store.errors";

/**
 * Every use-case in this module wraps a repository promise the same way —
 * mirrors `business/wrap-persistence.ts`.
 */
export function wrapPersistence<T>(promise: Promise<T>): ResultAsync<T, PersistenceFailedError> {
  return ResultAsync.fromPromise(promise, (cause): PersistenceFailedError => ({
    type: "persistence_failed",
    cause: String(cause),
  }));
}
