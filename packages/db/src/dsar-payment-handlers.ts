import type pg from "pg";
import type { DomainHandler, HandlerRegistry } from "@yourtal/consent/dsar-orchestrator";

/**
 * The `payment_cards` DSAR domain (5.1.d, 5.1.h): a bidder's customer, saved card and card-setup history,
 * here and at the processor.
 *
 * `yourtal_app` holds no DELETE on the `payment` tables, so the rows go through a SECURITY DEFINER
 * function (migration 20261020171646) that deletes rows for the one subject it is given, where the
 * owner is a user. A second run finds nothing and returns 0.
 *
 * ## The processor first, the rows second
 *
 * The rows are our only record of the processor's customer reference. So the customer is deleted at the
 * processor first, and the rows go only once every such delete has succeeded. If the processor is down the
 * handler throws: the orchestrator reports the domain `failed` and the rows stay, which is the record a retry
 * works from. The orchestrator has no retry of its own, and by then the identity domain has erased the
 * session, so `purgeDeletedAccountCustomers` (run by the worker) retries every user-owned customer whose
 * account no longer exists.
 */

/** One processor customer of a user, as our rows record it. */
export interface PaymentCustomer {
  readonly provider: "stripe" | "simulated";
  readonly region: "AU" | "ID";
  readonly customerRef: string;
}

/**
 * Deletes the customer at the processor. Resolves when it is gone (or already was); throws when it
 * could not be reached or refused, so the rows stay.
 */
export type ProcessorCustomerDeleter = (customer: PaymentCustomer) => Promise<void>;

/** Every distinct processor customer the user's customer, card and (re)placed-card rows name. */
async function customersOf(pool: pg.Pool, subjectId: string): Promise<PaymentCustomer[]> {
  const { rows } = await pool.query<{ provider: string; region: string; customer_ref: string }>(
    `SELECT provider, region, customer_ref FROM payment.customer
      WHERE owner_kind = 'user' AND owner_id::text = $1
     UNION
     SELECT provider, region, customer_ref FROM payment.saved_card
      WHERE owner_kind = 'user' AND owner_id::text = $1`,
    [subjectId],
  );
  return rows.map((row) => ({
    provider: row.provider as PaymentCustomer["provider"],
    region: row.region as PaymentCustomer["region"],
    customerRef: row.customer_ref,
  }));
}

export function erasePaymentCards(
  pool: pg.Pool,
  deleteAtProcessor: ProcessorCustomerDeleter,
): DomainHandler {
  return async (subjectId: string): Promise<number> => {
    let refused = 0;
    for (const customer of await customersOf(pool, subjectId)) {
      try {
        await deleteAtProcessor(customer);
      } catch {
        // Keep going: one processor being down must not stop the other customers' deletes.
        refused += 1;
      }
    }
    if (refused > 0) {
      throw new Error(
        `The processor did not confirm deleting ${String(refused)} saved-card customer(s); the rows are kept so the deletion can be retried.`,
      );
    }
    const { rows } = await pool.query<{ erased: number }>(
      `SELECT platform.erase_payment_subject($1) AS erased`,
      [subjectId],
    );
    return rows[0]?.erased ?? 0;
  };
}

/**
 * Retries the deletion for accounts that are already gone: users who still have a customer or card row
 * but no profile. Idempotent; a processor that is still down leaves the rows for the next run.
 */
export async function purgeDeletedAccountCustomers(
  pool: pg.Pool,
  deleteAtProcessor: ProcessorCustomerDeleter,
  limit = 100,
): Promise<{ readonly erased: number; readonly failed: number }> {
  const { rows } = await pool.query<{ subject: string }>(
    `SELECT subject FROM (
       SELECT owner_id::text AS subject FROM payment.customer WHERE owner_kind = 'user'
       UNION
       SELECT owner_id::text FROM payment.saved_card WHERE owner_kind = 'user'
     ) held
      WHERE NOT EXISTS (SELECT 1 FROM identity.user_profile p WHERE p.user_id = held.subject)
      LIMIT $1`,
    [limit],
  );
  const handler = erasePaymentCards(pool, deleteAtProcessor);
  let erased = 0;
  let failed = 0;
  for (const { subject } of rows) {
    try {
      await handler(subject);
      erased += 1;
    } catch {
      failed += 1;
    }
  }
  return { erased, failed };
}

/** Without a processor to delete at, the domain is left unhandled: a deletion that cannot reach it says so. */
export function paymentHandlers(
  pool: pg.Pool,
  deleteAtProcessor?: ProcessorCustomerDeleter,
): HandlerRegistry {
  return deleteAtProcessor === undefined
    ? {}
    : { payment_cards: erasePaymentCards(pool, deleteAtProcessor) };
}
