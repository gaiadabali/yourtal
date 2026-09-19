import { describe, expect, it } from "vitest";
import { getPublicMerchant, listPublicMerchants } from "./public-merchant";
import { slugify } from "./public-slug";

const LONG_MERCHANT_NAME =
  "Warung Kopi Kenangan Manis Nusantara Jaya Abadi Sentosa Cabang Kebayoran Baru";

describe("listPublicMerchants", () => {
  it("groups a campaign and a listing under the same merchant when their merchantName matches", () => {
    const merchants = listPublicMerchants();
    const longNameMerchant = merchants.find((merchant) => merchant.name === LONG_MERCHANT_NAME);

    expect(longNameMerchant).toBeDefined();
    // Both the "long merchant name" campaign fixture and the
    // "above plausible balance" listing fixture use this exact name, so a
    // real merchant page for it has both a campaign and an offer to show.
    expect(longNameMerchant?.campaigns.length).toBeGreaterThan(0);
    expect(longNameMerchant?.listings.length).toBeGreaterThan(0);
  });

  it("derives district from listings only, since campaigns carry no district", () => {
    const merchants = listPublicMerchants();
    const kopiSentosa = merchants.find((merchant) => merchant.name === "Kopi Sentosa");

    expect(kopiSentosa?.district).toBe("Kemang");
  });

  it("returns null district for a merchant with campaigns but no listings", () => {
    const merchants = listPublicMerchants();
    const merchantWithNoListings = merchants.find((merchant) => merchant.listings.length === 0);

    expect(merchantWithNoListings).toBeDefined();
    expect(merchantWithNoListings?.district).toBeNull();
  });

  it("every merchant's slug is the slugified form of its name", () => {
    for (const merchant of listPublicMerchants()) {
      expect(merchant.slug).toBe(slugify(merchant.name));
    }
  });
});

describe("getPublicMerchant", () => {
  it("finds a merchant by its slug", () => {
    const merchant = getPublicMerchant(slugify("Kopi Sentosa"));
    expect(merchant?.name).toBe("Kopi Sentosa");
  });

  it("returns undefined for a slug no campaign or listing carries", () => {
    expect(getPublicMerchant("no-such-merchant-anywhere")).toBeUndefined();
  });
});
