import { err, ok, type Result } from "neverthrow";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { VoucherInternalClient } from "../../../shared/voucher-client/voucher-internal-client";
import type { SagaRepository, StoredSaga } from "../persistence/saga.repository";

/** How long a reservation may sit before recovery settles it. */
export const RESERVATION_MS = 10 * 60_000;
const ACTIVATE_ATTEMPTS = 3;

export interface SagaDeps {
  readonly sagas: SagaRepository;
  readonly ledger: LedgerInternalClient;
  readonly vouchers: VoucherInternalClient;
  readonly now: () => Date;
}

export type CheckoutOutcome = Pick<StoredSaga, "id" | "state" | "voucherId" | "pricePoints">;

/**
 * 4.7.a, in order: pre-check, reserve, burn, activate, done. Every step is
 * keyed on the saga id, so a retry of any step replays instead of repeating
 * it. Before the burn a failure releases the voucher; after it, the points
 * are gone and the only way forward is the voucher (activate, retried by
 * recovery), or back (release and reinstate) when the voucher is unusable.
 */
export async function runSaga(
  deps: SagaDeps,
  saga: StoredSaga,
): Promise<Result<CheckoutOutcome, LedgerError>> {
  let current = saga;
  if (current.state === "quoted") {
    if (current.quoteExpiresAt.getTime() <= deps.now().getTime()) {
      return err(ledgerError("quote_expired", "the price hold has ended; ask for a new quote"));
    }
    // 1. Pre-check with no side effects.
    const balance = await deps.ledger.balance(current.userId);
    if (balance.isErr()) return err(balance.error);
    if (balance.value.availablePoints < current.pricePoints) {
      return err(ledgerError("insufficient_available", "not enough points to spend"));
    }
    // 2. Reserve.
    const reserved = await deps.vouchers.reserve({
      listingId: current.listingId,
      sagaId: current.id,
    });
    if (reserved.isErr()) return err(reserved.error);
    current = await deps.sagas.advance(current.id, "quoted", "reserved", {
      voucherId: reserved.value.voucherId,
      reservedUntil: new Date(deps.now().getTime() + RESERVATION_MS),
    });
  }

  if (current.state === "reserved") {
    // 3. Burn, from available, at the quote the ledger locked.
    const burned = await deps.ledger.burnForVoucher({
      userId: current.userId,
      listingId: current.listingId,
      points: current.pricePoints,
      sagaId: current.id,
      quoteId: current.quoteId,
    });
    if (burned.isErr()) {
      await release(deps, current);
      return err(burned.error);
    }
    current = await deps.sagas.advance(current.id, "reserved", "burned", {});
  }

  if (current.state === "burned") {
    // 4. Activate, retried: the points are already spent.
    const activated = await activate(deps, current);
    if (activated.isErr()) {
      if (!unusable(activated.error)) return ok(outcome(current)); // recovery retries
      await release(deps, current);
      const back = await deps.ledger.reinstateBurn(current.id);
      if (back.isErr()) return err(back.error);
      await deps.sagas.advance(current.id, "released", "voided", {});
      return err(activated.error);
    }
    // 5. Done.
    current = await deps.sagas.advance(current.id, "burned", "done", {});
  }

  if (current.state === "done") return ok(outcome(current));
  return err(ledgerError("idempotency_conflict", `this checkout already ended (${current.state})`));
}

async function activate(deps: SagaDeps, saga: StoredSaga) {
  let last = await tryActivate(deps, saga);
  for (
    let attempt = 1;
    attempt < ACTIVATE_ATTEMPTS && last.isErr() && !unusable(last.error);
    attempt++
  ) {
    last = await tryActivate(deps, saga);
  }
  return last;
}

// An unreachable voucher service is not a refusal (null): the points are
// spent, so the saga stays `burned` for recovery instead of throwing.
async function tryActivate(
  deps: SagaDeps,
  saga: StoredSaga,
): Promise<Result<unknown, LedgerError | null>> {
  try {
    return await deps.vouchers.activate({ sagaId: saga.id, ownerId: saga.userId });
  } catch {
    return err(null);
  }
}

// The voucher can never be activated: stop and give the points back.
function unusable(error: LedgerError | null): error is LedgerError {
  return error?.code === "kill_switch" || error?.code === "idempotency_conflict";
}

async function release(deps: SagaDeps, saga: StoredSaga): Promise<void> {
  const released = await deps.vouchers.release({ sagaId: saga.id });
  if (released.isOk()) await deps.sagas.advance(saga.id, saga.state, "released", {});
}

function outcome(saga: StoredSaga): CheckoutOutcome {
  return {
    id: saga.id,
    state: saga.state,
    voucherId: saga.voucherId,
    pricePoints: saga.pricePoints,
  };
}
