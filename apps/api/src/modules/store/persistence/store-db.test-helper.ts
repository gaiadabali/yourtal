import { sql } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { listingPriceRevisions } from "./schema/listing-price-revision.table";
import { listingLocations, listings, merchantLocations } from "./schema/listing.table";
import { settlementDecreaseRequests } from "./schema/settlement-decrease-request.table";
// TASKS.md 9.2.c: store.voucher_batch_request holds a NOT NULL FK to
// store.listings (20260927130000) -- a staff-review test that leaves one
// pending or decided breaks every later suite's own `DELETE FROM listings`
// the same way voucher.vouchers etc. below already do, so it is cleared
// child-first here too.
import { voucherBatchRequests } from "./schema/voucher-batch-request.table";
// TASKS.md 8.1.a: store.counter_device (a devices module table, `store`
// schema) holds a composite FK to store.merchant_location — cleared here,
// child-first, for the same reason listingLocations/listings are.
import { counterDevices } from "../../devices/persistence/schema/counter-device.table";
// TASKS.md 8.2.b/8.2.h: an INSERT-only audit trail (no DELETE grant for
// yourtal_app, 20260927170000_counter_capture_log.sql) with a FK to
// counter_device — a suite that drives a real capture (e.g.
// counter-idempotency.e2e.test.ts, 8.2.h) leaves a row here the
// counterDevices delete below then violates. Found live: this file's own
// FK-graph comment predates 8.2.h's first real capture in a shared test DB.
import { counterCaptureLog } from "../../devices/persistence/schema/counter-capture-log.table";

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
 *
 * No hard-coded dev URL fallback (YT-0571): `vitest.config.ts`'s
 * `setupFiles` already refuses to run this suite unless `DATABASE_URL` names
 * a `yourtal_test_*` database, so falling back to it is as safe as
 * `TEST_DATABASE_URL`.
 */
/**
 * `yourtal_app` lost INSERT/UPDATE/DELETE on `voucher.vouchers` in
 * `20260920000019_voucher_lifecycle.sql` — voucher issuance is value-path,
 * same reasoning as the ledger. Clearing seeded vouchers for this module's
 * own test database needs the owner, exactly as `watch.controller.test.ts`
 * does for `watch.session`; widening the app grant back to make cleanup
 * convenient would undo a control that exists on purpose.
 */

export function testStoreDb(): AppDb {
  return createAppDb(process.env["TEST_DATABASE_URL"] ?? requiredEnv("DATABASE_URL"));
}

/** Not `!`: this file is not `*.test.ts`, so the strict lint config applies. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} is not set — see vitest.config.ts's setupFiles.`);
  }
  return value;
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
  // No literal fallback: `DATABASE_OWNER_URL` is required and guarded by
  // `vitest.config.ts`'s `setupFiles`, same as `DATABASE_URL` above.
  const owner = createAppDb(requiredEnv("DATABASE_OWNER_URL"));
  await owner.execute(sql`DELETE FROM voucher.refund`);
  await owner.execute(sql`DELETE FROM voucher.capture`);
  await owner.execute(sql`DELETE FROM voucher.authorization`);
  await owner.execute(sql`DELETE FROM voucher.event`);
  await owner.execute(sql`DELETE FROM voucher.code_custody`);
  await owner.execute(sql`DELETE FROM voucher.vouchers`);
  await owner.execute(sql`DELETE FROM voucher.batch`);
  // Child-first within the store tables too: a revision row may reference a
  // settlement_decrease_request (YT-0575), and a request row references a
  // listing.
  await db.delete(listingPriceRevisions);
  await db.delete(settlementDecreaseRequests);
  // No DELETE grant for yourtal_app on store.voucher_batch_request
  // (20260927130000_voucher_batch_request.sql grants SELECT/INSERT/UPDATE
  // only) -- the owner connection, same reason every line above it is.
  await owner.delete(voucherBatchRequests);
  await db.delete(listingLocations);
  await db.delete(listings);
  // Child-first ahead of counter_device itself (see the import's own
  // comment): also owner-only, no DELETE grant for yourtal_app.
  await owner.delete(counterCaptureLog);
  // `store.counter_device` (8.1.a) only grants yourtal_app SELECT/INSERT/
  // UPDATE -- no DELETE (20260927140000_counter_devices.sql) -- so this one
  // needs the owner connection too, same reason every voucher.* line above
  // does. Still child-first: it holds a composite FK to merchant_location.
  await owner.delete(counterDevices);
  await db.delete(merchantLocations);
}
