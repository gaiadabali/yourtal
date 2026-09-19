import type { Listing } from "@yourtal/contracts/listing";
import {
  abovePlausibleBalanceListingFixture,
  expiringSoonListingFixture,
  mockListings,
  soldOutListingFixture,
} from "@yourtal/contracts/listing/mock";
import { REGION_LISTING_FIXTURES } from "@yourtal/contracts/region/mock";
import type { PublicLocale } from "./public-locale";

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
 *
 * **Locale-scoped (YT-0181).** `"id"` keeps the exact catalogue this ticket
 * always used; `"au"` reads `REGION_LISTING_FIXTURES.AU` from
 * `@yourtal/contracts/region/mock` — a real, independently-seeded Sydney
 * catalogue in `audCents`, not the same Rupiah amounts relabelled (see
 * `public-locale.ts`'s header). Every lookup takes the locale rather than
 * searching both, so an `/au/rewards/...` URL for an ID-only listing 404s
 * instead of silently serving Jakarta stock under an Australian URL.
 */
const PUBLIC_LISTING_CATALOGUE_ID: Listing[] = [
  ...mockListings,
  soldOutListingFixture,
  abovePlausibleBalanceListingFixture,
  expiringSoonListingFixture,
];

function catalogueFor(locale: PublicLocale): readonly Listing[] {
  if (locale === "au") {
    const au = REGION_LISTING_FIXTURES.AU;
    return [au.soldOut, au.longMerchantName, ...au.catalogue];
  }
  return PUBLIC_LISTING_CATALOGUE_ID;
}

/** Every listing eligible for a public catalogue/offer page, for this locale. */
export function listPublicListings(locale: PublicLocale): Listing[] {
  return [...catalogueFor(locale)];
}

/** A single listing for the public offer page, or `undefined` if no such listing exists in this locale's fixed catalogue. */
export function getPublicListing(listingId: string, locale: PublicLocale): Listing | undefined {
  return catalogueFor(locale).find((listing) => listing.id === listingId);
}
