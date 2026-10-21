import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { ReceiptProgrammeView } from "@yourtal/contracts/billing";
import { partnersFundedBy } from "@yourtal/contracts/billing/receipt-funder";
import { toPoints } from "@yourtal/contracts/money";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";
import type { BusinessRegionLookup } from "../../store/persistence/business-region-lookup";
import { gstRateBpsFor } from "../../payments/tax-rate";
import type { ReceiptProgrammeError } from "../billing.errors";
import { wrapLedgerCall, wrapPersistence } from "../wrap-billing";
import { toPointPackage } from "./quote-purchase.use-case";

type Deps = {
  readonly ledger: Pick<
    LedgerInternalClient,
    "getSettings" | "receiptPackageTiers" | "listAllocations"
  >;
  readonly businesses: BusinessRegionLookup;
  readonly settings: RegionSettingsReader;
};

/**
 * 2.10.b (F127, docs/27 section 3.5): the receipt funder's panel. The funder is
 * whoever an approved `receipt_funder.*` setting names in the business's own
 * region; anyone else is `not_a_receipt_funder`. Packages are the tier sizes at
 * cost with GST on top (F118). `earning` is true when the receipt packages have
 * room for one receipt.
 */
export function getReceiptProgramme(
  deps: Deps,
  merchantId: string,
): ResultAsync<ReceiptProgrammeView, ReceiptProgrammeError> {
  return wrapPersistence(deps.businesses.findRegionAndCurrency(merchantId)).andThen((business) => {
    if (business === null) {
      return errAsync<ReceiptProgrammeView, ReceiptProgrammeError>({
        type: "business_not_found",
        businessId: merchantId,
      });
    }
    const { region } = business;
    return wrapPersistence(deps.ledger.getSettings(region)).andThen((settings) => {
      const partners = partnersFundedBy(settings, merchantId, region);
      if (partners.length === 0) {
        return errAsync<ReceiptProgrammeView, ReceiptProgrammeError>({
          type: "not_a_receipt_funder",
        });
      }
      const perReceipt = settings.find((setting) => setting.key === "receipt_points")?.value;
      const pointsPerReceipt = typeof perReceipt === "number" ? perReceipt : 1;
      return wrapLedgerCall(
        deps.ledger.receiptPackageTiers({ region, businessId: merchantId }),
      ).andThen((tiers) =>
        wrapLedgerCall(deps.ledger.listAllocations(merchantId)).andThen((allocations) =>
          wrapPersistence(gstRateBpsFor(deps.settings, region)).map((taxRateBps) => {
            const remaining = allocations
              .filter((allocation) => allocation.programme === "receipts")
              .reduce((sum, allocation) => sum + allocation.remainingPoints, 0);
            return {
              partners,
              pointsPerReceipt: toPoints(pointsPerReceipt),
              earning: remaining >= pointsPerReceipt,
              remainingPoints: toPoints(remaining),
              packages: tiers.map((tier) => toPointPackage(tier, taxRateBps)),
            };
          }),
        ),
      );
    });
  });
}
