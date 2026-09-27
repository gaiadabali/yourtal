import { toMinorUnits } from "@yourtal/contracts/money";
import type { Currency } from "@yourtal/contracts/money/currency";
import type { Region } from "@yourtal/contracts/region";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";

/**
 * 7.4.b (EM-01): the one place this module asks the ledger what a listing
 * costs. Thrown rather than returned as a `Result`, because both call sites
 * (`DrizzleListingRepository.create`, `apply-settlement-value-change.ts`)
 * already run inside a `Promise`-returning repository method that a
 * use-case wraps with `ResultAsync.fromPromise` -- this lets that wrap
 * distinguish "the ledger refused to price this" from an ordinary
 * persistence failure by `instanceof`, without a second parallel `Result`
 * plumbed through every layer in between.
 */
export class ListingPricingError extends Error {
  constructor(cause: string) {
    super(cause);
    this.name = "ListingPricingError";
  }
}

export interface PriceListingArgs {
  readonly listingId: string;
  readonly region: Region;
  readonly currency: Currency;
  readonly settlementMinor: number;
}

/** The points price for a listing's current settlement value, per `ledger-client.priceListing`. */
export async function priceListingPoints(
  ledger: Pick<LedgerInternalClient, "priceListing">,
  args: PriceListingArgs,
): Promise<number> {
  const result = await ledger.priceListing({
    listingId: args.listingId,
    region: args.region,
    currency: args.currency,
    settlementMinor: toMinorUnits(args.settlementMinor),
  });
  if (result.isErr()) {
    throw new ListingPricingError(`${result.error.code}: ${result.error.message}`);
  }
  return result.value.pricePoints;
}
