import type { Listing } from "@yourtal/contracts/listing";
import { StoreListingCard } from "./store-listing-card";
import type { SupportedLocale } from "./store-i18n";

type SupportedCurrency = "AUD" | "IDR";

export interface StoreGridProps {
  listings: readonly Listing[];
  locale: SupportedLocale;
  currency: SupportedCurrency;
}

/**
 * The Store's dense card grid (YT-0420, docs/17-surfaces-and-roles.md §1:
 * "Tokopedia product grid"). Same responsive column count as the Earn
 * board's `CampaignGrid` — widening on larger viewports, not a different
 * layout (docs/17 §1.1).
 */
export function StoreGrid({ listings, locale, currency }: StoreGridProps) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {listings.map((listing) => (
        <li key={listing.id} className="min-w-0">
          <StoreListingCard listing={listing} locale={locale} currency={currency} />
        </li>
      ))}
    </ul>
  );
}
