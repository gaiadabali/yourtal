import { errAsync, ResultAsync } from "neverthrow";
import type { PurchaseQuote } from "@yourtal/contracts/billing";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { withTax } from "@yourtal/contracts/money/tax";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";
import type { BusinessRegionLookup } from "../../store/persistence/business-region-lookup";
import { gstRateBpsFor } from "../../payments/tax-rate";
import type { QuotePurchaseError } from "../billing.errors";
import { wrapLedgerCall, wrapPersistence } from "../wrap-billing";

/**
 * 7.5.a: pack prices at F12's fixed rate. `P_issue` only, never `B` --
 * `quotePurchase` never carries it. F118: the ledger's price is ex-GST;
 * GST at the region's rate is added on top, half up to a whole minor unit.
 */
export function quotePurchase(
  ledger: Pick<LedgerInternalClient, "quotePurchase">,
  businessRegionLookup: BusinessRegionLookup,
  settings: RegionSettingsReader,
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
      ).andThen((quote) =>
        wrapPersistence(gstRateBpsFor(settings, business.region)).map((taxRateBps) => {
          const split = withTax(quote.totalMinor, taxRateBps);
          return {
            points: pointsBranded,
            subtotalMinor: toMinorUnits(split.subtotalMinor),
            taxMinor: toMinorUnits(split.taxMinor),
            totalMinor: toMinorUnits(split.totalMinor),
            taxRateBps,
            currency: quote.currency,
          };
        }),
      );
    },
  );
}
