import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../persistence/drizzle-client";
import type { LedgerInternalClient } from "./ledger-internal-client";
import { FakeLedgerClient } from "./fake-ledger-client";
import { HttpLedgerClient, type LedgerCaller } from "./http-ledger-client";

/** TASKS.md 1.2.d's fake/live switch, shared by apps/api and apps/worker. */
export function createLedgerClient(
  config: Pick<AppConfig, "ledger">,
  db: AppDb,
  caller: LedgerCaller = "api",
): LedgerInternalClient {
  if (config.ledger.mode !== "live") {
    return new FakeLedgerClient(db);
  }
  const secret = config.ledger.serviceSecret;
  if (secret === undefined || secret.length < 32) {
    throw new Error(
      "LEDGER_MODE=live needs LEDGER_SERVICE_SECRET (at least 32 bytes) to sign ledger calls",
    );
  }
  return new HttpLedgerClient(config.ledger.baseUrl, secret, db, caller);
}
