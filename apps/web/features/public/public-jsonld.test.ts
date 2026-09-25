import { describe, expect, it } from "vitest";
import { soldOutListingFixture, expiringSoonListingFixture } from "@yourtal/contracts/listing/mock";
import { publicLocaleConfig } from "./public-locale";
import {
  buildBreadcrumbJsonLd,
  buildCatalogueItemListJsonLd,
  buildMerchantLocalBusinessJsonLd,
  buildMerchantOrganizationJsonLd,
  buildOfferProductJsonLd,
} from "./public-jsonld";

describe("buildBreadcrumbJsonLd", () => {
  it("numbers positions from 1", () => {
    const jsonLd = buildBreadcrumbJsonLd([
      { name: "Home", url: "https://yourtal.com/id" },
      { name: "Kopi Sentosa", url: "https://yourtal.com/id/m/kopi-sentosa" },
    ]) as { itemListElement: { position: number }[] };
    expect(jsonLd.itemListElement.map((item) => item.position)).toEqual([1, 2]);
  });
});

describe("buildOfferProductJsonLd", () => {
  it("prices the offer at its genuine face value, never the points figure", () => {
    const jsonLd = buildOfferProductJsonLd({
      listing: soldOutListingFixture,
      url: "https://yourtal.com/id/rewards/kopi-sentosa/abc",
      imageUrl: "https://yourtal.com/id/rewards/kopi-sentosa/abc/opengraph-image",
      merchantUrl: "https://yourtal.com/id/m/kopi-sentosa",
      locale: publicLocaleConfig("id"),
    }) as { offers: { price: string; priceCurrency: string; availability: string } };

    // Rp 30.000, as a decimal major-unit amount. IDR's minor unit is the
    // whole Rupiah (FOUNDER DECISION T-1, exponent 0), so the builder's
    // MINOR_UNIT-driven scaling emits "30000" with no decimal places —
    // the same mechanism AUD uses at its own exponent, not a special case.
    expect(jsonLd.offers.price).toBe("30000");
    expect(jsonLd.offers.priceCurrency).toBe("IDR");
    expect(jsonLd.offers.availability).toBe("https://schema.org/OutOfStock");
  });

  it("marks a listing with remaining stock as in stock", () => {
    const jsonLd = buildOfferProductJsonLd({
      listing: expiringSoonListingFixture,
      url: "https://yourtal.com/id/rewards/toko-berkah/xyz",
      imageUrl: "https://yourtal.com/id/rewards/toko-berkah/xyz/opengraph-image",
      merchantUrl: "https://yourtal.com/id/m/toko-berkah",
      locale: publicLocaleConfig("id"),
    }) as { offers: { availability: string } };

    expect(jsonLd.offers.availability).toBe("https://schema.org/InStock");
  });
});

describe("buildMerchantOrganizationJsonLd", () => {
  it("emits an Organization, not a LocalBusiness, since no address data exists", () => {
    const jsonLd = buildMerchantOrganizationJsonLd({
      merchant: {
        slug: "kopi-sentosa",
        name: "Kopi Sentosa",
        district: "Kemang",
        campaigns: [],
        listings: [],
      },
      url: "https://yourtal.com/id/m/kopi-sentosa",
      imageUrl: "https://yourtal.com/id/m/kopi-sentosa/opengraph-image",
    }) as { "@type": string };

    expect(jsonLd["@type"]).toBe("Organization");
  });
});

describe("buildMerchantLocalBusinessJsonLd", () => {
  it("returns null for a merchant with no listing at all", () => {
    const jsonLd = buildMerchantLocalBusinessJsonLd({
      merchant: {
        slug: "no-listings",
        name: "No Listings Co",
        district: null,
        campaigns: [],
        listings: [],
      },
      organizationUrl: "https://yourtal.com/id/m/no-listings",
      locale: "id",
    });
    expect(jsonLd).toBeNull();
  });

  it("emits one LocalBusiness node per distinct outlet, never fewer than the listing really has", () => {
    // soldOutListingFixture is Kopi Sentosa, a single-location fixture.
    const jsonLd = buildMerchantLocalBusinessJsonLd({
      merchant: {
        slug: "kopi-sentosa",
        name: "Kopi Sentosa",
        district: "Kemang",
        campaigns: [],
        listings: [soldOutListingFixture],
      },
      organizationUrl: "https://yourtal.com/id/m/kopi-sentosa",
      locale: "id",
    }) as { "@graph": { "@type": string; address: { addressCountry: string } }[] };

    expect(jsonLd["@graph"]).toHaveLength(soldOutListingFixture.locations.length);
    expect(jsonLd["@graph"][0]?.["@type"]).toBe("LocalBusiness");
    expect(jsonLd["@graph"][0]?.address.addressCountry).toBe("ID");
  });

  it("does not collapse a multi-branch merchant into one node, and dedupes a shared location", () => {
    const secondListing = {
      ...soldOutListingFixture,
      id: "00000000-0000-4000-8000-00000000dead",
    };
    const jsonLd = buildMerchantLocalBusinessJsonLd({
      merchant: {
        slug: "kopi-sentosa",
        name: "Kopi Sentosa",
        district: "Kemang",
        campaigns: [],
        // Two listings sharing the exact same location must not double it.
        listings: [soldOutListingFixture, secondListing],
      },
      organizationUrl: "https://yourtal.com/id/m/kopi-sentosa",
      locale: "id",
    }) as { "@graph": unknown[] };

    expect(jsonLd["@graph"]).toHaveLength(soldOutListingFixture.locations.length);
  });
});

describe("buildCatalogueItemListJsonLd", () => {
  it("builds one ListItem per entry", () => {
    const jsonLd = buildCatalogueItemListJsonLd([
      { name: "Voucher A", url: "https://yourtal.com/id/rewards/a/1" },
      { name: "Voucher B", url: "https://yourtal.com/id/rewards/b/2" },
    ]) as { itemListElement: unknown[] };
    expect(jsonLd.itemListElement).toHaveLength(2);
  });
});
