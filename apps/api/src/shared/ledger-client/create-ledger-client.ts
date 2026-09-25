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
  return config.ledger.mode === "live"
    ? new HttpLedgerClient(config.ledger.baseUrl, config.ledger.serviceSecret, db, caller)
    : new FakeLedgerClient(db);
}
