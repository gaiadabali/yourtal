import { publicListingSchema } from "@yourtal/contracts/listing";
import type { Listing, PublicListing } from "@yourtal/contracts/listing";
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

/**
 * Strips the listing down to what a public surface may carry.
 *
 * The fixtures behind this module are merchant-facing `Listing`s and so
 * carry `settlementValueIdr` — S, what the merchant is paid. Publishing S
 * beside `priceInPoints` publishes the backing rate by arithmetic
 * (`B = S / priceInPoints`, exactly, since the demand multiplier is pinned
 * at 1.0), which `docs/24` ID-1 names as the single largest legal exposure
 * in the plan: points are a loyalty currency rather than e-money BECAUSE
 * there is no published fixed cash rate.
 *
 * Parsing here rather than omitting S at each render is the whole point.
 * `publicListingSchema` **cannot express S**, so every consumer downstream
 * of this boundary is structurally incapable of rendering it — the same
 * "unrepresentable rather than excluded" move the schema's own header
 * describes. Relying on each public component to not reach for the field
 * would make safety a matter of discipline, and discipline is what fails
 * quietly when a component is copied.
 *
 * Nothing currently leaks S — it appears in no built public page. This
 * closes the shape of the hole, not a live breach.
 */
function toPublic(listing: Listing): PublicListing {
  return publicListingSchema.parse(listing);
}

/** Every listing eligible for a public catalogue/offer page, for this locale. */
export function listPublicListings(locale: PublicLocale): PublicListing[] {
  return catalogueFor(locale).map(toPublic);
}

/** A single listing for the public offer page, or `undefined` if no such listing exists in this locale's fixed catalogue. */
export function getPublicListing(listingId: string, locale: PublicLocale): PublicListing | undefined {
  const found = catalogueFor(locale).find((listing) => listing.id === listingId);
  return found ? toPublic(found) : undefined;
}
