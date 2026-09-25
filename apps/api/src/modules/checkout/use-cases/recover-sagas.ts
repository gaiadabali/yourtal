import { runSaga, type SagaDeps } from "./run-saga";

export interface RecoveryReport {
  readonly finished: number;
  readonly released: number;
  readonly stillStuck: number;
}

/**
 * 4.7.a's recovery: a saga a crash left `reserved` past its reservation
 * finishes if the ledger burned for it and is released if not; one left
 * `burned` retries activation. The ledger's burn record decides, never the
 * saga row, because the crash may have landed between the burn and the row.
 */
export async function recoverSagas(deps: SagaDeps, limit = 50): Promise<RecoveryReport> {
  let finished = 0;
  let released = 0;
  let stillStuck = 0;
  for (const saga of await deps.sagas.listUnfinished(deps.now(), limit)) {
    let current = saga;
    if (current.state === "reserved") {
      const burned = await deps.ledger.getBurn(current.id).then(
        (result) => result.isOk() && result.value.state === "burned",
        () => false,
      );
      if (!burned) {
        const back = await deps.vouchers.release({ sagaId: current.id });
        if (back.isOk()) {
          await deps.sagas.advance(current.id, "reserved", "released", {});
          released++;
        } else {
          stillStuck++;
        }
        continue;
      }
      current = await deps.sagas.advance(current.id, "reserved", "burned", {});
    }
    const outcome = await runSaga(deps, current);
    if (outcome.isOk() && outcome.value.state === "done") finished++;
    else if (outcome.isErr()) released++;
    else stillStuck++;
  }
  return { finished, released, stillStuck };
}
