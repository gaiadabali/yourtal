import type pg from "pg";
import type { DomainHandler, HandlerRegistry } from "@yourtal/consent/dsar-orchestrator";

/**
 * The `payment_cards` DSAR domain (5.1.d): a bidder's customer, saved card and card-setup history.
 *
 * `yourtal_app` holds no DELETE on the `payment` tables, so this calls a SECURITY DEFINER
 * function (migration 20261020161342) that deletes rows for the one subject it is given, where the
 * owner is a user. A second run finds nothing and returns 0.
 */
export function erasePaymentCards(pool: pg.Pool): DomainHandler {
  return async (subjectId: string): Promise<number> => {
    const { rows } = await pool.query<{ erased: number }>(
      `SELECT platform.erase_payment_subject($1) AS erased`,
      [subjectId],
    );
    return rows[0]?.erased ?? 0;
  };
}

export function paymentHandlers(pool: pg.Pool): HandlerRegistry {
  return { payment_cards: erasePaymentCards(pool) };
}
