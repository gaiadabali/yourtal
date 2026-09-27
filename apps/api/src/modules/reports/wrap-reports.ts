import { ResultAsync } from "neverthrow";
import type { PersistenceFailedError } from "./reports.errors";

/** Mirrors `store/wrap-persistence.ts` and `billing/wrap-billing.ts`'s own copy. */
export function wrapPersistence<T>(promise: Promise<T>): ResultAsync<T, PersistenceFailedError> {
  return ResultAsync.fromPromise(promise, (cause): PersistenceFailedError => ({
    type: "persistence_failed",
    cause: String(cause),
  }));
}
