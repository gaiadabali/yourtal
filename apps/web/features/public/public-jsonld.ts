import type { Listing } from "@yourtal/contracts/listing";
import type { PublicMerchant } from "./public-merchant";
import type { PublicLocaleConfig } from "./public-locale";

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
 * - **`LocalBusiness` (or a subtype like `CafeOrCoffeeShop`, docs/11 §5.2's
 *   own example) on the merchant page** — `LocalBusiness` implies a real
 *   physical presence, and this ticket's merchant view
 *   (`public-merchant.ts`) is assembled from `merchantName` alone, with no
 *   address, geo-coordinates or category-to-premises signal (a
 *   `digital_goods` listing does not imply a shop front). `Organization` is
 *   the schema.org type every merchant genuinely satisfies regardless of
 *   physical presence, so that is what is emitted instead.
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
      // faceValueIdr is an integer count of the currency's minor unit for
      // IDR (see packages/contracts/src/money/money.ts) and cents for AUD;
      // schema.org's `price` wants a decimal amount, so AUD divides by 100
      // the same way `formatMoney` does and IDR does not.
      price:
        locale.currency === "AUD"
          ? (listing.faceValueIdr / 100).toFixed(2)
          : String(listing.faceValueIdr),
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
