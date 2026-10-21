import { funderFor } from "@yourtal/contracts/billing/receipt-funder";
import type { PartnerReceiptStatusResult } from "@yourtal/contracts/device/partner-action";
import type { Region } from "@yourtal/contracts/region";
import type { ResultAsync } from "neverthrow";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { PartnersError } from "../to-http-exception";
import { wrapPersistence } from "../wrap-persistence";

export interface ReceiptStatusDeps {
  readonly ledger: LedgerInternalClient;
  readonly receiptPoints: (region: Region) => Promise<number>;
}

export interface ReceiptStatusInput {
  readonly partnerId: string;
  readonly region: Region;
}

/**
 * 2.10.b (F127, docs/27 section 3.4): whether this partner's receipts are being
 * paid. The funder is the region setting `receipt_funder.<partnerId>`; its
 * receipt packages are the funder's allocations with `programme: "receipts"` in
 * the region (the existing `listAllocations` read). `earning` means at least
 * one package has room for one receipt; no funder or no package answers
 * `earning: false, remainingPoints: 0`. Nothing here names the business.
 */
export function receiptStatus(
  deps: ReceiptStatusDeps,
  input: ReceiptStatusInput,
): ResultAsync<PartnerReceiptStatusResult, PartnersError> {
  const { region } = input;
  return wrapPersistence(
    Promise.all([deps.ledger.getSettings(region), deps.receiptPoints(region)]),
  ).andThen(([settings, pointsPerReceipt]) => {
    const funder = funderFor(settings, input.partnerId, region);
    if (funder === null) {
      return wrapPersistence(
        Promise.resolve<PartnerReceiptStatusResult>({
          region,
          earning: false,
          pointsPerReceipt,
          remainingPoints: 0,
        }),
      );
    }
    return deps.ledger
      .listAllocations(funder)
      .map((allocations): PartnerReceiptStatusResult => {
        const packages = allocations.filter(
          (allocation) => allocation.programme === "receipts" && allocation.region === region,
        );
        return {
          region,
          earning: packages.some((p) => p.remainingPoints >= pointsPerReceipt),
          pointsPerReceipt,
          remainingPoints: packages.reduce((sum, p) => sum + p.remainingPoints, 0),
        };
      })
      .mapErr((error): PartnersError => error);
  });
}
