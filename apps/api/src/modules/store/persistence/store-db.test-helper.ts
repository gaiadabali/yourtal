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
const APP_URL = "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal";
/**
 * `yourtal_app` lost INSERT/UPDATE/DELETE on `voucher.vouchers` in
 * `20260920000019_voucher_lifecycle.sql` — voucher issuance is value-path,
 * same reasoning as the ledger. Clearing seeded vouchers for this module's
 * own test database needs the owner, exactly as `watch.controller.test.ts`
 * does for `watch.session`; widening the app grant back to make cleanup
 * convenient would undo a control that exists on purpose.
 */
const OWNER_URL = "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal";

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
  // NOT NULL foreign key to `store.listings` (YT-0519) -- clearing it
  // here is the same move `watch.controller.test.ts` makes for
  // `watch.session`, not a cross-module read. The OWNER connection, because
  // `yourtal_app` cannot DELETE these tables (see `OWNER_URL`'s comment
  // above), and on `voucher.code_custody` it holds no grant at all.
  //
  // CHILD-FIRST, along the whole foreign-key graph rather than the part that
  // happened to fail last. Four tables reference `store.listings` --
  // `voucher.vouchers` (20260919000004), `store.listing_location`
  // (20260919000009), `voucher.batch` (20260920000015) and
  // `store.listing_price_revision` (20260920040000) -- and `voucher.vouchers`
  // in turn references `voucher.batch`. Hence:
  //   refund -> capture -> authorization -> event -> code_custody
  //     -> vouchers -> batch, then the store tables below.
  //
  // This list was enumerated from the migrations, not discovered one CI run
  // at a time. Two rounds were: a bare `DELETE FROM voucher.vouchers` broke
  // on code_custody, and clearing custody then broke on batch. Fixing the
  // constraint a failure names, rather than reading the graph, turns one
  // defect into as many red runs as the graph has edges.
  const owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? OWNER_URL);
  await owner.execute(sql`DELETE FROM voucher.refund`);
  await owner.execute(sql`DELETE FROM voucher.capture`);
  await owner.execute(sql`DELETE FROM voucher.authorization`);
  await owner.execute(sql`DELETE FROM voucher.event`);
  await owner.execute(sql`DELETE FROM voucher.code_custody`);
  await owner.execute(sql`DELETE FROM voucher.vouchers`);
  await owner.execute(sql`DELETE FROM voucher.batch`);
  await db.delete(listingPriceRevisions);
  await db.delete(listingLocations);
  await db.delete(listings);
  await db.delete(merchantLocations);
}
