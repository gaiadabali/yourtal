import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { PointPackage, PointPackages } from "@yourtal/contracts/billing";
import type { PackageTierQuote } from "@yourtal/contracts/ledger-internal/pricing";
import { toMinorUnits } from "@yourtal/contracts/money";
import { withTax } from "@yourtal/contracts/money/tax";
import type { Region } from "@yourtal/contracts/region";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";
import type { BusinessRegionLookup } from "../../store/persistence/business-region-lookup";
import { gstRateBpsFor } from "../../payments/tax-rate";
import type { QuotePurchaseError } from "../billing.errors";
import { wrapLedgerCall, wrapPersistence } from "../wrap-billing";

/**
 * 14.13 (F122): point packages as Studio sells them. The ledger prices each
 * tier (P_issue less its discount, never B); F118: GST at the region's rate
 * goes on top, half up to a whole minor unit.
 */
export function toPointPackage(quote: PackageTierQuote, taxRateBps: number): PointPackage {
  const split = withTax(quote.totalMinor, taxRateBps);
  return {
    tierKey: quote.tierKey,
    points: quote.points,
    discountBps: quote.discountBps,
    subtotalMinor: toMinorUnits(split.subtotalMinor),
    taxMinor: toMinorUnits(split.taxMinor),
    totalMinor: toMinorUnits(split.totalMinor),
    taxRateBps,
    currency: quote.currency,
    // Display only, rounded up: never shows a package cheaper than it is.
    pricePer1000Minor: toMinorUnits(Math.ceil((quote.totalMinor * 1_000) / quote.points)),
    savingMinor: toMinorUnits(Math.max(0, quote.undiscountedMinor - quote.totalMinor)),
  };
}

type Deps = {
  readonly ledger: Pick<LedgerInternalClient, "packageTiers" | "quotePackage">;
  readonly businesses: BusinessRegionLookup;
  readonly settings: RegionSettingsReader;
};

function withBusinessRegion<T>(
  deps: Deps,
  merchantId: string,
  then: (region: Region) => ResultAsync<T, QuotePurchaseError>,
): ResultAsync<T, QuotePurchaseError> {
  return wrapPersistence(deps.businesses.findRegionAndCurrency(merchantId)).andThen((business) =>
    business === null
      ? errAsync<T, QuotePurchaseError>({ type: "business_not_found", businessId: merchantId })
      : then(business.region),
  );
}

/** Every package on sale in the business's region, smallest first. */
export function listPackages(
  deps: Deps,
  merchantId: string,
): ResultAsync<PointPackages, QuotePurchaseError> {
  return withBusinessRegion(deps, merchantId, (region) =>
    wrapLedgerCall(deps.ledger.packageTiers(region)).andThen((quotes) =>
      wrapPersistence(gstRateBpsFor(deps.settings, region)).map((taxRateBps) => ({
        packages: quotes.map((quote) => toPointPackage(quote, taxRateBps)),
      })),
    ),
  );
}

/** One package, priced now. An unknown tier is the ledger's `refused`. */
export function quotePurchase(
  deps: Deps,
  merchantId: string,
  tierKey: string,
): ResultAsync<PointPackage, QuotePurchaseError> {
  return withBusinessRegion(deps, merchantId, (region) =>
    wrapLedgerCall(deps.ledger.quotePackage({ region, tierKey })).andThen((quote) =>
      wrapPersistence(gstRateBpsFor(deps.settings, region)).map((taxRateBps) =>
        toPointPackage(quote, taxRateBps),
      ),
    ),
  );
}
