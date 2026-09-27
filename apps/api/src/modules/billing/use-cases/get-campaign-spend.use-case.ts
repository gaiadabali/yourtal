import { errAsync, ResultAsync } from "neverthrow";
import type { BillingCampaignSpend } from "@yourtal/contracts/billing";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { GetCampaignSpendError } from "../billing.errors";
import { wrapLedgerCall } from "../wrap-billing";

/**
 * 7.5.b's per-campaign spend. There is no campaign table this module can
 * read yet (7.3 is a different, concurrently-built stream) -- ownership is
 * proven instead through the ledger's OWN allocation graph: a campaign's
 * spend names the `allocationId` it drew from, and that allocation belongs
 * to exactly one business (`ledger-client.listAllocations`). A campaign
 * whose allocation is not one of this business's own is treated exactly
 * like one that does not exist -- same "don't disclose" reasoning every
 * other cross-tenant lookup in this module follows.
 */
export function getCampaignSpend(
  ledger: Pick<LedgerInternalClient, "campaignSpend" | "listAllocations">,
  merchantId: string,
  campaignId: string,
): ResultAsync<BillingCampaignSpend, GetCampaignSpendError> {
  return wrapLedgerCall(ledger.campaignSpend(campaignId)).andThen((spend) =>
    wrapLedgerCall(ledger.listAllocations(merchantId)).andThen((allocations) => {
      const owns = allocations.some((allocation) => allocation.allocationId === spend.allocationId);
      if (!owns) {
        return errAsync<BillingCampaignSpend, GetCampaignSpendError>({
          type: "campaign_spend_not_owned",
          campaignId,
        });
      }
      return ResultAsync.fromSafePromise(
        Promise.resolve({
          campaignId: spend.campaignId,
          grantedPoints: spend.grantedPoints,
          completions: spend.completions,
        }),
      );
    }),
  );
}
