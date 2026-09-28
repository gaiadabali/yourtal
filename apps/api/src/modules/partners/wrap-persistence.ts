import { ResultAsync } from "neverthrow";
import type { PersistenceFailedError } from "./partners.errors";

/** Same shape as every other module's own `wrap-persistence.ts` — one `persistence_failed` case per module. */
export function wrapPersistence<T>(promise: Promise<T>): ResultAsync<T, PersistenceFailedError> {
  return ResultAsync.fromPromise(promise, (cause): PersistenceFailedError => ({
    type: "persistence_failed",
    cause: String(cause),
  }));
}
