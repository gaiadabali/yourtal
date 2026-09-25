import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../persistence/drizzle-client";
import type { VoucherInternalClient } from "./voucher-internal-client";
import { FakeVoucherClient } from "./fake-voucher-client";
import { HttpVoucherClient } from "./http-voucher-client";

/** TASKS.md 1.2.d's fake/live switch — mirrors `createLedgerClient.ts`. */
export function createVoucherClient(config: Pick<AppConfig, "ledger">, db: AppDb): VoucherInternalClient {
  return config.ledger.mode === "live"
    ? new HttpVoucherClient(config.ledger.voucherBaseUrl)
    : new FakeVoucherClient(db);
}
