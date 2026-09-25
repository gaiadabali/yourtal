import type { AppDb } from "../persistence/drizzle-client";
import { createAppDb } from "../persistence/drizzle-client";

/**
 * A real Postgres handle for cross-module test suites (ledger-client and
 * voucher-client's contract specs) that do not belong to any one module's
 * own `test*Db()` helper. `TEST_DATABASE_URL` first, same as every other
 * module's helper — `vitest.config.ts`'s setup file already refuses to run
 * against anything but a `yourtal_test_*` database.
 */
export function testDb(): AppDb {
  const url = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined) {
    throw new Error("TEST_DATABASE_URL (or DATABASE_URL) must be set to run this suite");
  }
  return createAppDb(url);
}
