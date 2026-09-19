import type { Listing } from "@yourtal/contracts/listing";
import {
  abovePlausibleBalanceListingFixture,
  expiringSoonListingFixture,
  mockListings,
  soldOutListingFixture,
} from "@yourtal/contracts/listing/mock";

/**
 * Data access for the public catalogue and offer pages (YT-0431,
 * `/[locale]/rewards` and `/[locale]/rewards/[merchant]/[offerId]`). Mirrors
 * `public-campaign-data.ts`'s reasoning: fixed mock catalogue only, no
 * `mock-source` seam (nothing live to switch to yet) and no synthesised
 * fallback for an arbitrary id (a public offer page must correspond to a
 * real listing, or 404 — see that file's header for the full argument).
 *
 * `docs/11-seo-aeo-geo.md` §2.3 says an expired offer should 301 to its
 * merchant page rather than 404. `Listing.status`
 * (`packages/contracts/src/listing/listing.ts`) has no "expired" value —
 * only `available`/`sold_out`/`expiring_soon`/`new` — so there is no signal
 * in this contract to trigger that redirect from; a sold-out listing is
 * still shown honestly (sold out is not expired) rather than hidden or
 * redirected. This gap is worth raising with the architect if/when an
 * `expiresAt`-driven expiry state is added to the contract.
 */
const PUBLIC_LISTING_CATALOGUE: Listing[] = [
  ...mockListings,
  soldOutListingFixture,
  abovePlausibleBalanceListingFixture,
  expiringSoonListingFixture,
];

/** Every listing eligible for a public catalogue/offer page. */
export function listPublicListings(): Listing[] {
  return [...PUBLIC_LISTING_CATALOGUE];
}

/** A single listing for the public offer page, or `undefined` if no such listing exists in the fixed catalogue. */
export function getPublicListing(listingId: string): Listing | undefined {
  return PUBLIC_LISTING_CATALOGUE.find((listing) => listing.id === listingId);
}
