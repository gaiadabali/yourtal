import { sql } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { DisputeReason, DisputeResult } from "@yourtal/contracts/checkout/dispute";
import { ledgerError, type LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { toPoints } from "@yourtal/contracts/money";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { SagaDeps } from "./run-saga";

/**
 * 4.7.c, K13: a voucher the merchant would not honour. Uncaptured, it is
 * voided and the exact points go back to available at once. Captured (the
 * voucher service answers `already_granted`), the points are not returned
 * here: the dispute is queued for staff (9.4), who recover it from the
 * merchant (10.1). Every step replays, so a retried dispute is harmless.
 */
export async function disputeVoucher(
  deps: SagaDeps,
  db: AppDb,
  userId: string,
  voucherId: string,
  reason: DisputeReason,
): Promise<Result<DisputeResult, LedgerError>> {
  const saga = await deps.sagas.findByVoucher(voucherId, userId);
  if (saga === null || (saga.state !== "done" && saga.state !== "voided")) {
    return err(ledgerError("audience_blocked", "no finished checkout holds this voucher"));
  }

  const voided =
    saga.state === "voided"
      ? ok(undefined)
      : await deps.vouchers.voidVoucher({ voucherId, ownerId: userId, reason });
  if (voided.isErr() && voided.error.code !== "already_granted") return err(voided.error);
  const outcome = voided.isOk() ? "reinstated" : "queued";

  if (outcome === "reinstated") {
    const back = await deps.ledger.reinstateBurn(saga.id);
    if (back.isErr()) return err(back.error);
    await deps.sagas.advance(saga.id, "done", "voided", {});
  }
  await db.execute(sql`
    INSERT INTO checkout.dispute (voucher_id, saga_id, user_id, reason, outcome)
    VALUES (${voucherId}::uuid, ${saga.id}::uuid, ${userId}::uuid, ${reason}, ${outcome})
    ON CONFLICT (voucher_id) DO NOTHING`);
  return ok({
    voucherId,
    outcome,
    points: toPoints(outcome === "reinstated" ? saga.pricePoints : 0),
  });
}
