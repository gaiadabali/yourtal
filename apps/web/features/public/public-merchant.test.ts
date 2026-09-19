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

    expect(kopiSentosa).toBeDefined();
    // Asserted against this merchant's OWN listings rather than a hardcoded
    // district. The district comes from seeded generation, so pinning the
    // literal made this test a tripwire for any change to faker draw order —
    // it failed on the merchant-roster fix having found nothing wrong. The
    // property that actually matters is that the district is one the
    // merchant's listings really reach.
    const reachable = new Set(
      (kopiSentosa?.listings ?? []).flatMap((listing) =>
        listing.locations.map((location) => location.district),
      ),
    );
    expect(reachable.size).toBeGreaterThan(0);
    expect(reachable).toContain(kopiSentosa?.district);
  });

  it("has a district if and only if it has listings", () => {
    // Was "returns null district for a merchant with campaigns but no
    // listings", which searched the generated data for such a merchant. That
    // example existed only because campaigns and listings drew INDEPENDENT
    // random merchantIds, so their merchant sets were disjoint by accident —
    // the same defect that made every prototype redemption fail
    // `wrong_merchant`. Now both draw from the shared roster, so no such
    // merchant remains and the search found nothing.
    //
    // The biconditional is the property that was meant: it covers the null
    // branch without needing an example to survive, and it checks the
    // non-null branch for every merchant, so it cannot pass vacuously.
    const merchants = listPublicMerchants();
    expect(merchants.length).toBeGreaterThan(0);

    for (const merchant of merchants) {
      expect(merchant.district === null).toBe(merchant.listings.length === 0);
    }
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
