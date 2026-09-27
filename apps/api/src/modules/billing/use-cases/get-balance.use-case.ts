import type { ResultAsync } from "neverthrow";
import type { BillingBalance } from "@yourtal/contracts/billing";
import { toPoints } from "@yourtal/contracts/money";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { GetBalanceError } from "../billing.errors";
import { wrapLedgerCall } from "../wrap-billing";

/**
 * 7.5.b: balance and remainder. `remainingPoints` on each allocation is
 * already "remaining minus active holds" -- `ledger-client.hold` decrements
 * `remaining_points` at the moment a hold is placed, so there is nothing
 * further to subtract here.
 */
export function getBalance(
  ledger: Pick<LedgerInternalClient, "listAllocations">,
  merchantId: string,
): ResultAsync<BillingBalance, GetBalanceError> {
  return wrapLedgerCall(ledger.listAllocations(merchantId)).map((allocations) => ({
    totalPoints: toPoints(allocations.reduce((sum, a) => sum + a.totalPoints, 0)),
    remainingPoints: toPoints(allocations.reduce((sum, a) => sum + a.remainingPoints, 0)),
    allocations: [...allocations],
  }));
}
