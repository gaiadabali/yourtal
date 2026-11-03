import { sql } from "drizzle-orm";
import type { AppDb } from "../../shared/persistence/drizzle-client";

export const BURN_VOUCHER_READER = Symbol("BURN_VOUCHER_READER");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ledger knows a burn by its checkout saga and the store item it paid for,
 * never by the voucher it produced. The saga row holds that voucher, so a
 * history line can point at the voucher it made instead of at the store item.
 */
export class BurnVoucherReader {
  constructor(private readonly db: AppDb) {}

  /** Saga id to voucher id, for this user's finished checkouts only. */
  async vouchersBySaga(
    userId: string,
    sagaIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const ids = [...new Set(sagaIds.filter((id) => UUID.test(id)))];
    if (ids.length === 0) return new Map();
    const { rows } = await this.db.execute<{ id: string; voucher_id: string }>(sql`
      SELECT id::text, voucher_id::text FROM checkout.saga
       WHERE user_id = ${userId}::uuid AND state = 'done' AND voucher_id IS NOT NULL
         AND id IN (${sql.join(
           ids.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
    `);
    return new Map(rows.map((row) => [row.id, row.voucher_id]));
  }
}
