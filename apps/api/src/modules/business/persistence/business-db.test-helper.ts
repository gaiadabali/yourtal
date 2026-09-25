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
 * Empties the business tables, child-first.
 *
 * Order matters and is not defensive: `billing_contacts` and `kyb_documents`
 * both reference `business_accounts`, and `business_members` does too.
 * Deleting the parent first is a foreign-key violation — which is itself one
 * of the constraints an in-memory store could never have shown us.
 *
 * Called at the START of a suite rather than only at the end. A test that
 * fails part-way leaves its rows behind, and the next run then collides on a
 * unique index and fails for a reason unrelated to what it tests — burying a
 * real failure under a fake one.
 */
export async function clearBusinessTables(db: BusinessDb): Promise<void> {
  await db.delete(kybDocuments);
  await db.delete(billingContacts);
  await db.delete(businessMembers);
  await db.delete(businessAccounts);
}
