import { inArray } from "drizzle-orm";
import type { BusinessDb } from "./drizzle-client";
import { createBusinessDb } from "./drizzle-client";
import { billingContacts } from "./schema/billing-contact.table";
import { businessAccounts } from "./schema/business-account.table";
import { businessMembers } from "./schema/business-member.table";
import { kybDocuments } from "./schema/kyb-document.table";

/**
 * A real Postgres handle for tests. YT-0552.
 *
 * ## Why there is no in-memory option here
 *
 * There used to be. `business.module.ts` wired in-memory repositories
 * whenever `DATABASE_URL` was absent, and every test in this module used
 * them — so seven controllers, every Drizzle query and every schema
 * constraint were typechecked and **never executed**. The suite was green
 * and the database had never been touched.
 *
 * The in-memory implementations are deleted rather than moved behind a flag.
 * A fallback is the thing tests quietly select, and one that engages only
 * when configuration is missing engages precisely when nobody is watching.
 *
 * What that buys is the constraints: unique indexes, composite foreign keys,
 * `NOT NULL`, and the role grants are all invisible to a `Map`. A use-case
 * test that passes against a fake proves the use-case is self-consistent; it
 * proves nothing about whether the database will accept the row.
 */

/**
 * The app role, deliberately — not the owner.
 *
 * Tests run as the role the application runs as, so a missing grant fails
 * here rather than in production. Where cleanup needs a permission the app
 * genuinely should not have, the owner connection is used for that step
 * alone (see `packages/db/src/watch-session.test.ts`) rather than widening
 * the grant to make a test convenient.
 *
 * No hard-coded dev URL fallback (YT-0571): `vitest.config.ts`'s
 * `setupFiles` already refuses to run this suite unless `DATABASE_URL`
 * names a `yourtal_test_*` database, which `with-test-db.mjs` sets to the
 * app role too — so falling back to it here is as safe as `TEST_DATABASE_URL`.
 */
export function testBusinessDb(): BusinessDb {
  return createBusinessDb(process.env["TEST_DATABASE_URL"] ?? requiredEnv("DATABASE_URL"));
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
 * Deletes only the businesses owned by the given fixture user ids —
 * child-first, then the account itself. YT-0547's cross-FILE half.
 *
 * ## Why this takes ids now, and used to take none
 *
 * It used to be an unconditional whole-table wipe, called from every
 * business-module file's own `beforeAll`. That was safe only as long as
 * `apps/api` ran its files one at a time (`fileParallelism: false`) — the
 * moment two files run concurrently against the SAME per-package database
 * (YT-0547's per-package half), one file's "DELETE everything, insert my
 * fixture, assert" erases a neighbour's fixture mid-test. It reproduces the
 * cross-PACKAGE bug this ticket was filed for, one layer down: a different
 * file fails each run, and every one passes alone. See
 * `apps/api/vitest.config.ts` for where that was proved by removing the
 * flag and watching it fail.
 *
 * The fix is the one `packages/db`'s own suites already use
 * (`voucher-constraints.test.ts`, `watch-session.test.ts`): scope cleanup to
 * rows a test itself created, identified by a fixture id unique to the
 * FILE, rather than wiping the table for everyone. `business_accounts` has
 * no "created by" column of its own, but every business created through
 * `createBusiness`/`createBusinessWithOwner` gets an owner row in
 * `business_members` in the same transaction (docs/17 section 2.1: a
 * business and its founding owner membership exist together or not at
 * all) — so the owner's user id is the tag, found via that join, and
 * `business_members`/`billing_contacts`/`kyb_documents` are deleted by the
 * `business_id`s that resolves to before the account rows themselves go.
 *
 * Each calling file now uses a fixture user id that no sibling file
 * reuses (they used to share literals like `"owner-1"`, which would have
 * kept the race: two files tagging their fixtures identically are exactly
 * as unsafe as no tag at all). Called at the START of a suite as well as
 * the end — a test that fails part-way leaves its rows behind, and with a
 * stable per-file tag the NEXT run of that same file (e.g. under
 * `vitest --watch`, which does not get a fresh database the way a fresh
 * `with-test-db.mjs` invocation does) would otherwise collide on
 * `business_members`'s `(business_id, user_id)` unique index.
 */
export async function clearBusinessTables(
  db: BusinessDb,
  ownerUserIds: readonly string[],
): Promise<void> {
  if (ownerUserIds.length === 0) {
    return;
  }
  const owned = await db
    .select({ businessId: businessMembers.businessId })
    .from(businessMembers)
    .where(inArray(businessMembers.userId, ownerUserIds));
  const businessIds = [...new Set(owned.map((row) => row.businessId))];
  if (businessIds.length === 0) {
    return;
  }
  await db.delete(kybDocuments).where(inArray(kybDocuments.businessId, businessIds));
  await db.delete(billingContacts).where(inArray(billingContacts.businessId, businessIds));
  await db.delete(businessMembers).where(inArray(businessMembers.businessId, businessIds));
  await db.delete(businessAccounts).where(inArray(businessAccounts.id, businessIds));
}
