import type { Listing } from "@yourtal/contracts/listing";
import { StoreListingCard } from "./store-listing-card";

export interface StoreGridProps {
  listings: readonly Listing[];
}

/**
 * The Store's dense card grid (YT-0420, docs/17-surfaces-and-roles.md §1:
 * "Tokopedia product grid"). Same responsive column count as the Earn
 * board's `CampaignGrid` — widening on larger viewports, not a different
 * layout (docs/17 §1.1).
 */
export function StoreGrid({ listings }: StoreGridProps) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {listings.map((listing) => (
        <li key={listing.id}>
          <StoreListingCard listing={listing} />
        </li>
      ))}
    </ul>
  );
}
