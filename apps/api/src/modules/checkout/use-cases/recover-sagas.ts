import { LedgerNotFoundError } from "../../../shared/ledger-client/ledger-not-found";
import type { StoredSaga } from "../persistence/saga.repository";
import { runSaga, type SagaDeps } from "./run-saga";

export interface RecoveryReport {
  readonly finished: number;
  readonly released: number;
  readonly stillStuck: number;
}

type Settled = "finished" | "released" | "stillStuck";

/**
 * 4.7.a's recovery: a saga a crash left `reserved` past its reservation
 * finishes if the ledger burned for it and is released if not; one left
 * `burned` retries activation. The ledger's burn record decides, never the
 * saga row, because the crash may have landed between the burn and the row.
 * A saga whose services cannot answer waits for the next tick, and never
 * stops the others from recovering.
 */
export async function recoverSagas(deps: SagaDeps, limit = 50): Promise<RecoveryReport> {
  const report = { finished: 0, released: 0, stillStuck: 0 };
  for (const saga of await deps.sagas.listUnfinished(deps.now(), limit)) {
    const settled = await recoverOne(deps, saga).catch((): Settled => "stillStuck");
    report[settled]++;
  }
  return report;
}

async function recoverOne(deps: SagaDeps, saga: StoredSaga): Promise<Settled> {
  let current = saga;
  if (current.state === "reserved") {
    const burn = await burnState(deps, current.id);
    if (burn === "unknown") return "stillStuck";
    // A reinstated burn has already given the points back, so it releases too.
    if (burn !== "burned") {
      const back = await deps.vouchers.release({ sagaId: current.id });
      if (back.isErr()) return "stillStuck";
      await deps.sagas.advance(current.id, "reserved", "released", {});
      return "released";
    }
    current = await deps.sagas.advance(current.id, "reserved", "burned", {});
  }
  const outcome = await runSaga(deps, current);
  if (outcome.isErr()) return "released";
  return outcome.value.state === "done" ? "finished" : "stillStuck";
}

// Only a ledger that answers "no such burn" lets the voucher go: releasing on
// an outage would free a voucher whose points were spent.
async function burnState(
  deps: SagaDeps,
  sagaId: string,
): Promise<"burned" | "reinstated" | "none" | "unknown"> {
  try {
    const burn = await deps.ledger.getBurn(sagaId);
    return burn.isOk() ? burn.value.state : "unknown";
  } catch (error) {
    return error instanceof LedgerNotFoundError ? "none" : "unknown";
  }
}
