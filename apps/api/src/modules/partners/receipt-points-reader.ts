import type { Region } from "@yourtal/contracts/region";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";

/** F12's `receipt_points` region setting (1.2.f) — same read shape `me/streak.service.ts`'s own `settingValue` uses. */
export function receiptPointsReader(ledger: LedgerInternalClient) {
  return async (region: Region): Promise<number> => {
    const settings = await ledger.getSettings(region);
    const value = settings.find((setting) => setting.key === "receipt_points")?.value;
    if (typeof value !== "number") {
      throw new Error(`receipt_points setting missing or malformed for region ${region}`);
    }
    return value;
  };
}
