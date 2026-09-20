import { sql } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { listingPriceRevisions } from "./schema/listing-price-revision.table";
import { listingLocations, listings, merchantLocations } from "./schema/listing.table";

/**
 * A real Postgres handle for this module's tests, following the pattern
 * `watch.controller.test.ts` set (YT-0553) rather than the older
 * per-module `createBusinessDb` (YT-0552): `createAppDb` is shared, so this
 * file only supplies the URL and the table-clearing helper.
 *
 * `TEST_DATABASE_URL` is resolved FIRST and is not touched by
 * `vitest.config.ts` (which only sets `DATABASE_URL`) — this is what makes a
 * dead-host sabotage of this module's own database provable rather than
 * silently reverted. See this ticket's report for the actual proof run.
 */
const APP_URL = "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal_wt_store";
/**
 * `yourtal_app` lost INSERT/UPDATE/DELETE on `voucher.vouchers` in
 * `20260920000019_voucher_lifecycle.sql` — voucher issuance is value-path,
 * same reasoning as the ledger. Clearing seeded vouchers for this module's
 * own test database needs the owner, exactly as `watch.controller.test.ts`
 * does for `watch.session`; widening the app grant back to make cleanup
 * convenient would undo a control that exists on purpose.
 */
const OWNER_URL = "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_wt_store";

export function testStoreDb(): AppDb {
  return createAppDb(process.env["TEST_DATABASE_URL"] ?? APP_URL);
}

/**
 * Empties this module's tables, child-first, at the START of a suite (not
 * only the end) -- a run that fails part-way must not poison the next one
 * with a leftover row that collides on a unique index for an unrelated
 * reason. Same rule `clearBusinessTables` documents.
 */
export async function clearStoreTables(db: AppDb): Promise<void> {
  // `voucher.vouchers` is a different module's table, but it holds a
  // NOT NULL foreign key to `store.listings` (YT-0519) and this worktree's
  // database is this module's own (see the ticket report) -- clearing it
  // here is the same move `watch.controller.test.ts` makes for
  // `watch.session`, not a cross-module read. The OWNER connection, because
  // `yourtal_app` cannot DELETE this table (see `OWNER_URL`'s comment above).
  await createAppDb(OWNER_URL).execute(sql`DELETE FROM voucher.vouchers`);
  await db.delete(listingPriceRevisions);
  await db.delete(listingLocations);
  await db.delete(listings);
  await db.delete(merchantLocations);
}
