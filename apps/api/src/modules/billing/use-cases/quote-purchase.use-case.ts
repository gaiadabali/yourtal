import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { PurchaseQuote } from "@yourtal/contracts/billing";
import { toPoints } from "@yourtal/contracts/money";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { BusinessRegionLookup } from "../../store/persistence/business-region-lookup";
import type { QuotePurchaseError } from "../billing.errors";
import { wrapLedgerCall, wrapPersistence } from "../wrap-billing";

/** 7.5.a: pack prices at F12's fixed rate. `P_issue` only, never `B` -- `quotePurchase` never carries it. */
export function quotePurchase(
  ledger: Pick<LedgerInternalClient, "quotePurchase">,
  businessRegionLookup: BusinessRegionLookup,
  merchantId: string,
  points: number,
): ResultAsync<PurchaseQuote, QuotePurchaseError> {
  return wrapPersistence(businessRegionLookup.findRegionAndCurrency(merchantId)).andThen(
    (business) => {
      if (business === null) {
        return errAsync<PurchaseQuote, QuotePurchaseError>({
          type: "business_not_found",
          businessId: merchantId,
        });
      }
      const pointsBranded = toPoints(points);
      return wrapLedgerCall(
        ledger.quotePurchase({ points: pointsBranded, region: business.region }),
      ).map((quote) => ({
        points: pointsBranded,
        totalMinor: quote.totalMinor,
        currency: quote.currency,
      }));
    },
  );
}
