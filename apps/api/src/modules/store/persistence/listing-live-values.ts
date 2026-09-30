import { sql } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

/** The subset of `AppDb` these need — satisfied by both a live handle and a transaction. */
type Db = Pick<AppDb, "execute">;

/**
 * 7.4.b/7.4.c: two values `store.listings`' own columns can go stale on and
 * are therefore never trusted at read time, only at write time (as a cache
 * -- see `drizzle-listing.repository.ts` and `apply-settlement-value-change.ts`):
 *
 *  - the points price, kept current by 4.9.a's ledger reprice job in
 *    `ledger.listing_price`, exposed to `yourtal_app` (no grant on `ledger`
 *    itself) through the `platform.listing_points` view;
 *  - stock, which is not a number a merchant declares at all any more --
 *    it is the count of this listing's vouchers still `minted` (issued,
 *    unallocated) in `voucher.vouchers`, the same table `4.5.a`'s reserve/
 *    release moves through `minted -> allocated`.
 *
 * Batched by listing id rather than run per-row inside `assembleListing`,
 * so a browse page of N listings costs two extra queries total, not 2N.
 */

/**
 * A dynamic `IN (...)` list, not `= ANY(${array})` — a bare JS array bound
 * as one raw-`sql` parameter does not reliably reach Postgres as an array
 * literal through node-postgres (proved by a live "malformed array literal"
 * failure against a real, non-empty list), where `sql.join` with one bound
 * parameter per id always works.
 */
function idList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

export async function pricePointsByListing(
  db: Db,
  listingIds: readonly string[],
): Promise<Map<string, number>> {
  if (listingIds.length === 0) return new Map();
  const result = await db.execute<{ listing_id: string; points: string }>(sql`
    SELECT listing_id, points FROM platform.listing_points WHERE listing_id IN (${idList(listingIds)})
  `);
  return new Map(result.rows.map((row) => [row.listing_id, Number(row.points)]));
}

export async function unallocatedStockByListing(
  db: Db,
  listingIds: readonly string[],
): Promise<Map<string, number>> {
  if (listingIds.length === 0) return new Map();
  const result = await db.execute<{ listing_id: string; count: string }>(sql`
    SELECT listing_id, count(*)::bigint AS count
      FROM voucher.vouchers
     WHERE listing_id IN (${idList(listingIds)}) AND state = 'minted'
     GROUP BY listing_id
  `);
  return new Map(result.rows.map((row) => [row.listing_id, Number(row.count)]));
}

/** 13.12.b's "popular": vouchers already bought from each listing (any state past `minted`). */
export async function takenVouchersByListing(
  db: Db,
  listingIds: readonly string[],
): Promise<Map<string, number>> {
  if (listingIds.length === 0) return new Map();
  const result = await db.execute<{ listing_id: string; count: string }>(sql`
    SELECT listing_id, count(*)::bigint AS count
      FROM voucher.vouchers
     WHERE listing_id IN (${idList(listingIds)}) AND state <> 'minted'
     GROUP BY listing_id
  `);
  return new Map(result.rows.map((row) => [row.listing_id, Number(row.count)]));
}
