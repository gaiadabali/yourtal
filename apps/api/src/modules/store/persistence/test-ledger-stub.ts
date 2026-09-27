import { FakeLedgerClient } from "../../../shared/ledger-client/fake-ledger-client";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";

/**
 * The real `FakeLedgerClient` against this suite's own test db, for the one
 * ledger operation this module's own repository tests need
 * (`priceListing`). Every migrated database (including a fresh test one)
 * already seeds F1's default backing rates
 * (`20260925190500_ledger_voucher_fake_tables.sql`: AU 3,000,000, ID
 * 6,000,000 micros/pt), so this needs no fixture of its own -- and, unlike a
 * hand-written stub, it actually upserts `ledger.listing_price` /
 * `platform.listing_points`, which `browsePublic`'s minPoints/maxPoints
 * filter reads.
 */
export function stubLedgerClient(db: AppDb): Pick<LedgerInternalClient, "priceListing"> {
  return new FakeLedgerClient(db);
}
