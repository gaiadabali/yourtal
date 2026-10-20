import { Logger } from "@nestjs/common";
import type { Allocation } from "@yourtal/contracts/ledger-internal/funding";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import type { Currency } from "@yourtal/contracts/money/currency";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type {
  CardPurchaseRepository,
  CardPurchaseRow,
} from "../persistence/card-purchase.repository";

const logger = new Logger("CardPurchase");

/** What the processor says it took. */
export interface PaymentReceived {
  readonly amountMinor: number | null;
  readonly currency: Currency | null;
  readonly paymentRef: string | null;
}

export interface FulfilDeps {
  readonly ledger: Pick<LedgerInternalClient, "purchasePoints">;
  readonly purchases: Pick<CardPurchaseRepository, "find" | "markPaid" | "markNeedsReview">;
}

/**
 * Refusals that pass on their own; the sender's retry tries again instead of parking the money.
 * `already_granted`: a concurrent delivery recorded this purchase first, and the retry reads it back.
 */
const TRANSIENT_REFUSALS = new Set(["kill_switch", "already_granted"]);

/**
 * Turns money received into points, once. The paid amount and currency must
 * equal the purchase's own total; the ledger is then asked for the ex-GST
 * subtotal (F118) under the purchase's own idempotency key, so a replay
 * returns the same allocation. If the ledger refuses (the rate rose while the
 * checkout was open), the purchase becomes `needs_review`: paid money is never
 * dropped. A ledger outage rejects, so the webhook answers 500 and is retried.
 */
export async function fulfilPurchase(
  deps: FulfilDeps,
  row: CardPurchaseRow,
  paid: PaymentReceived,
): Promise<{ readonly row: CardPurchaseRow; readonly allocation: Allocation | null }> {
  // Parked and refunded money is never turned into points by a replayed delivery (F123).
  if (row.status === "paid" || row.status === "needs_review" || row.status === "refunded") {
    return { row, allocation: null };
  }

  const park = async (reason: string) => {
    logger.error(`card purchase ${row.id} needs review: ${reason}`);
    await deps.purchases.markNeedsReview(row.id, paid.paymentRef, reason);
    return { row: await reread(deps, row.id), allocation: null };
  };

  if (paid.amountMinor !== row.totalMinor || paid.currency !== row.currency) {
    return park(
      `paid ${String(paid.amountMinor)} ${String(paid.currency)}, expected ${String(row.totalMinor)} ${row.currency}`,
    );
  }
  const granted = await deps.ledger.purchasePoints({
    businessId: row.businessId,
    region: row.region,
    currency: row.currency,
    points: toPoints(row.points),
    paidMinor: toMinorUnits(row.subtotalMinor),
    idempotencyKey: row.idempotencyKey,
    // 14.13: the ledger prices the package again now; a rate or tier change
    // since the checkout opened parks the money for review below.
    ...(row.tierKey === null ? {} : { tierKey: row.tierKey }),
  });
  if (granted.isErr()) {
    if (TRANSIENT_REFUSALS.has(granted.error.code)) {
      throw new Error(`ledger refused purchase ${row.id} for now: ${granted.error.code}`);
    }
    return park(`the ledger refused the points: ${granted.error.code}: ${granted.error.message}`);
  }
  await deps.purchases.markPaid(row.id, paid.paymentRef, granted.value.allocationId);
  return { row: await reread(deps, row.id), allocation: granted.value };
}

async function reread(deps: FulfilDeps, id: string): Promise<CardPurchaseRow> {
  const row = await deps.purchases.find(id);
  if (row === null) throw new Error(`card purchase ${id} vanished`);
  return row;
}
