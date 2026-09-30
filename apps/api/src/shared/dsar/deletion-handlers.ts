import type pg from "pg";
import { toPoints } from "@yourtal/contracts/money";
import type { DomainHandler, HandlerRegistry } from "@yourtal/consent/dsar-orchestrator";
import { postgresHandlers } from "@yourtal/db/dsar-handlers";
import type { LedgerInternalClient } from "../ledger-client/ledger-internal-client";

/**
 * The ledger's part of an account deletion (13.24). Nothing in the ledger is
 * deleted or edited: the balance moves into the user's escrow account with a
 * posting and is never released, so no later grant release or burn can spend
 * it, and the grants' device and IP are cleared. What stays is keyed only by
 * the opaque user id, whose identity rows the `identity` domain erases.
 *
 * Escrow, not forfeit to breakage: the points stay owed and backed by the
 * reserve (K6), so a deletion is never income, and staff can still return
 * them if a deletion turns out to be fraud.
 */
export function ledgerDeletionHandler(pool: pg.Pool, ledger: LedgerInternalClient): DomainHandler {
  return async (subjectId: string): Promise<number> => {
    const balance = await ledger.balance(subjectId);
    if (balance.isErr()) throw new Error(`ledger balance: ${balance.error.message}`);
    const pending = balance.value.pending.reduce((sum, bucket) => sum + bucket.points, 0);
    const total = balance.value.availablePoints + pending;

    let escrowed = 0;
    if (total > 0) {
      // Keyed by the amount too: a retry with the same balance is answered by
      // the first escrow, and a retry after a late release takes the rest.
      const held = await ledger.escrow({
        userId: subjectId,
        points: toPoints(total),
        reason: "account_deleted",
        idempotencyKey: `account-deleted:${subjectId}:${String(total)}`,
      });
      if (held.isErr()) throw new Error(`ledger escrow: ${held.error.message}`);
      escrowed = 1;
    }

    const { rows } = await pool.query<{ cleared: number }>(
      "SELECT platform.pseudonymise_ledger_subject($1) AS cleared",
      [subjectId],
    );
    return escrowed + (rows[0]?.cleared ?? 0);
  };
}

/** Every deletion handler the api can run: Postgres's plus the ledger's. */
export function deletionHandlers(pool: pg.Pool, ledger: LedgerInternalClient): HandlerRegistry {
  return { ...postgresHandlers(pool), ledger: ledgerDeletionHandler(pool, ledger) };
}
