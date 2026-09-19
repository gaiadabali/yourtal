import type { Listing } from "@yourtal/contracts/listing";
import type { PublicMerchant } from "./public-merchant";
import type { PublicLocale, PublicLocaleConfig } from "./public-locale";
import { minorUnitExponent } from "@yourtal/contracts/money/minor-unit";

/**
 * Structured-data builders for the public surface (YT-0431,
 * `docs/11-seo-aeo-geo.md` §5). Every type emitted here genuinely maps to
 * the entity's real fields — nothing is fabricated to chase a rich result.
 * Two schema.org types docs/11 §5 lists were deliberately NOT built, and
 * that refusal is as much this ticket's job as what is here:
 *
 * - **`VideoObject` on the campaign page** — the type's required/expected
 *   fields (`thumbnailUrl`, `contentUrl`/`embedUrl`, `uploadDate`) have no
 *   backing data: `Campaign` (`packages/contracts/src/campaign/campaign.ts`)
 *   has no video asset URL, no thumbnail and no upload timestamp
 *   (`publishedAt` is a catalogue date, not an upload date for a specific
 *   asset). Emitting `VideoObject` with the generated OG card image standing
 *   in for `thumbnailUrl` and no `contentUrl` at all would be exactly the
 *   "incorrect structured data" this ticket's brief says is worse than none.
 *   Revisit once the campaign contract carries a real media asset (this is
 *   also that campaign page's own honest reason for not embedding a player —
 *   Open Viewing, YT-0432, is not built yet either).
 * - **`LocalBusiness` when a merchant's view carries no listing at all** —
 *   `public-merchant.ts`'s view is grouped from whatever campaigns and
 *   listings share a merchant's name, and a merchant known only from a
 *   campaign has no address anywhere in this data (campaigns carry no
 *   location). `Organization` is what such a merchant genuinely satisfies;
 *   `buildMerchantLocalBusinessJsonLd` below returns `null` for exactly
 *   this case rather than fabricate a premises.
 *
 * **YT-0180: `LocalBusiness` now IS built** once a merchant has at least one
 * listing, from that listing's real `locations[]` (`merchant-location.ts`) —
 * a genuine street address and district, no geocoding, no invented category.
 * `listingDistrictLabel`'s rule applies here too: a merchant with branches
 * in more than one place is never described as if it had one. See
 * `buildMerchantLocalBusinessJsonLd`'s own doc comment for the shape.
 */

export interface JsonLdBreadcrumbItem {
  name: string;
  url: string;
}

export function buildBreadcrumbJsonLd(items: readonly JsonLdBreadcrumbItem[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * `Product` + `Offer` for a voucher page (docs/11 §5.1). `offers.price` is
 * the listing's genuine face value in the region's currency — never the
 * points cost dressed up as money (docs/11's "points-pricing trap"). The
 * points cost is carried separately as a loyalty `priceSpecification`,
 * truthfully, without claiming member-price rich-result eligibility.
 */
export function buildOfferProductJsonLd(params: {
  listing: Listing;
  url: string;
  imageUrl: string;
  merchantUrl: string;
  locale: PublicLocaleConfig;
}): object {
  const { listing, url, imageUrl, merchantUrl, locale } = params;
  const isAvailable = listing.status !== "sold_out" && listing.stockRemaining > 0;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: listing.title,
    description: listing.description,
    image: [imageUrl],
    brand: { "@type": "Brand", name: listing.merchantName },
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: locale.currency,
      // `faceValueIdr` is an integer count of the currency's minor unit;
      // schema.org's `price` wants a decimal major-unit amount, so it is
      // scaled by that currency's exponent.
      //
      // This used to branch on `currency === "AUD"` and divide by a literal
      // 100, leaving IDR undivided — correct only while the IDR minor unit
      // was one Rupiah. YT-0506 made IDR two-decimal and this line began
      // publishing **100x the real price** in structured data on a public
      // page, which is what Google Shopping and every rich result would
      // have read. It is the same duplicated-divisor bug `formatMoney` had,
      // in the one place a wrong number is machine-readable and indexed.
      //
      // `MINOR_UNIT` is now the only place that knowledge lives.
      price: (listing.faceValueIdr / 10 ** minorUnitExponent(locale.currency)).toFixed(
        minorUnitExponent(locale.currency),
      ),
      priceValidUntil: listing.expiresAt.slice(0, 10),
      availability: isAvailable ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      eligibleRegion: { "@type": "Country", name: locale.countryName },
      offeredBy: { "@id": `${merchantUrl}#organization` },
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        priceCurrency: locale.currency,
        price: "0",
        description: `Redeemed with ${listing.priceInPoints} YourTal points`,
        validForMemberTier: { "@type": "MemberProgramTier", name: "YourTal Member" },
      },
    },
  };
}

/** `Organization` for a merchant page — see this file's header for why not `LocalBusiness`. */
export function buildMerchantOrganizationJsonLd(params: {
  merchant: PublicMerchant;
  url: string;
  imageUrl: string;
}): object {
  const { merchant, url, imageUrl } = params;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${url}#organization`,
    name: merchant.name,
    url,
    image: [imageUrl],
  };
}

/** ISO 3166-1 alpha-2, for `PostalAddress.addressCountry` — schema.org accepts a country name but the two-letter code is the form Google's own examples use. */
const PUBLIC_LOCALE_COUNTRY_CODE: Record<PublicLocale, string> = { id: "ID", au: "AU" };

interface MerchantLocationLike {
  id: string;
  name: string;
  address: string;
  district: string;
}

/**
 * `LocalBusiness` per outlet, for a merchant whose listings carry real
 * `locations[]` (docs/11 §5.2 names `LocalBusiness`/`CafeOrCoffeeShop` as
 * the type that earns local-search placement; this file's header explains
 * why it used to be skipped entirely).
 *
 * Returns `null` for a merchant with no listing at all — see this file's
 * header for why `Organization` alone is the honest type there.
 *
 * **One `LocalBusiness` node per outlet, every one `branchOf` the parent
 * `Organization`** (`buildMerchantOrganizationJsonLd`'s `@id`) — never a
 * single `LocalBusiness` standing in for however many branches a merchant
 * actually has. A merchant with one outlet gets one node; a merchant with
 * three gets three, each with its own real address. This is the same rule
 * `listing-locations.ts`'s `listingDistrictLabel` enforces for display: a
 * multi-branch merchant is never described as single-site, here in
 * structured data rather than on-screen.
 */
export function buildMerchantLocalBusinessJsonLd(params: {
  merchant: PublicMerchant;
  organizationUrl: string;
  locale: PublicLocale;
}): object | null {
  const { merchant, organizationUrl, locale } = params;
  const locations = distinctMerchantLocations(merchant.listings);
  if (locations.length === 0) {
    return null;
  }

  const addressCountry = PUBLIC_LOCALE_COUNTRY_CODE[locale];
  return {
    "@context": "https://schema.org",
    "@graph": locations.map((location) => ({
      "@type": "LocalBusiness",
      "@id": `${organizationUrl}#location-${location.id}`,
      name: locations.length === 1 ? merchant.name : `${merchant.name} — ${location.name}`,
      branchOf: { "@id": `${organizationUrl}#organization` },
      address: {
        "@type": "PostalAddress",
        streetAddress: location.address,
        addressLocality: location.district,
        addressCountry,
      },
    })),
  };
}

/** Every location a merchant's listings reach, deduplicated by `id` — a location serving several listings must not become several `LocalBusiness` nodes. */
function distinctMerchantLocations(listings: readonly Listing[]): MerchantLocationLike[] {
  const byId = new Map<string, MerchantLocationLike>();
  for (const listing of listings) {
    for (const location of listing.locations) {
      byId.set(location.id, location);
    }
  }
  return [...byId.values()];
}

/** `ItemList` for the catalogue hub (docs/11 §5: "Helps carousel eligibility and list extraction"). */
export function buildCatalogueItemListJsonLd(
  items: readonly { name: string; url: string }[],
): object {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  };
}
