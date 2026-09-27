import { ResultAsync } from "neverthrow";
import type { PersistenceFailedError } from "./devices.errors";

/** Same shape as `business/wrap-persistence.ts` — one `persistence_failed` case for the whole module. */
export function wrapPersistence<T>(promise: Promise<T>): ResultAsync<T, PersistenceFailedError> {
  return ResultAsync.fromPromise(promise, (cause): PersistenceFailedError => ({
    type: "persistence_failed",
    cause: String(cause),
  }));
}
