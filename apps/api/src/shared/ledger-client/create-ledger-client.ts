import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../persistence/drizzle-client";
import { withAgeBandEnrichment } from "./age-band-ledger-client";
import type { LedgerInternalClient } from "./ledger-internal-client";
import { FakeLedgerClient } from "./fake-ledger-client";
import { HttpLedgerClient, type LedgerCaller } from "./http-ledger-client";

/**
 * TASKS.md 1.2.d's fake/live switch, shared by apps/api and apps/worker.
 * 12.1.c: wrapped in `withAgeBandEnrichment` either way, so every
 * `LEDGER_INTERNAL_CLIENT` this factory hands out — wallet, watch, streak,
 * partners, staff, dev — sets a real ageBand on every grant without its own
 * caller ever having to.
 */
export function createLedgerClient(
  config: Pick<AppConfig, "ledger">,
  db: AppDb,
  caller: LedgerCaller = "api",
): LedgerInternalClient {
  if (config.ledger.mode !== "live") {
    return withAgeBandEnrichment(new FakeLedgerClient(db), db);
  }
  const secret = config.ledger.serviceSecret;
  if (secret === undefined || secret.length < 32) {
    throw new Error(
      "LEDGER_MODE=live needs LEDGER_SERVICE_SECRET (at least 32 bytes) to sign ledger calls",
    );
  }
  return withAgeBandEnrichment(new HttpLedgerClient(config.ledger.baseUrl, secret, db, caller), db);
}
