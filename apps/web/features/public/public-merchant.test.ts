import { describe, expect, it } from "vitest";
import { getPublicMerchant, listPublicMerchants } from "./public-merchant";
import { slugify } from "./public-slug";

const LONG_MERCHANT_NAME =
  "Warung Kopi Kenangan Manis Nusantara Jaya Abadi Sentosa Cabang Kebayoran Baru";

describe("listPublicMerchants", () => {
  it("groups a campaign and a listing under the same merchant when their merchantName matches", () => {
    const merchants = listPublicMerchants("id");
    const longNameMerchant = merchants.find((merchant) => merchant.name === LONG_MERCHANT_NAME);

    expect(longNameMerchant).toBeDefined();
    // Both the "long merchant name" campaign fixture and the
    // "above plausible balance" listing fixture use this exact name, so a
    // real merchant page for it has both a campaign and an offer to show.
    expect(longNameMerchant?.campaigns.length).toBeGreaterThan(0);
    expect(longNameMerchant?.listings.length).toBeGreaterThan(0);
  });

  it("derives district from listings only, since campaigns carry no district", () => {
    const merchants = listPublicMerchants("id");
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
    const merchants = listPublicMerchants("id");
    expect(merchants.length).toBeGreaterThan(0);

    for (const merchant of merchants) {
      expect(merchant.district === null).toBe(merchant.listings.length === 0);
    }
  });

  it("every merchant's slug is the slugified form of its name", () => {
    for (const merchant of listPublicMerchants("id")) {
      expect(merchant.slug).toBe(slugify(merchant.name));
    }
  });
});

describe("getPublicMerchant", () => {
  it("finds a merchant by its slug", () => {
    const merchant = getPublicMerchant(slugify("Kopi Sentosa"), "id");
    expect(merchant?.name).toBe("Kopi Sentosa");
  });

  it("returns undefined for a slug no campaign or listing carries", () => {
    expect(getPublicMerchant("no-such-merchant-anywhere", "id")).toBeUndefined();
  });
});

describe("locale scoping (YT-0181)", () => {
  // `"id"` was the only value this ever ran against, so testing it alone
  // proves nothing about the locale parameter itself — see
  // docs/13-engineering-standards.md §4 on why the default is not the test.
  // AU and ID read independently-seeded catalogues (Sydney vs. Jakarta
  // merchants), so this asserts the two genuinely disagree rather than one
  // silently falling back to the other's data.
  it("AU and ID resolve to different merchant sets", () => {
    const idMerchants = new Set(listPublicMerchants("id").map((merchant) => merchant.slug));
    const auMerchants = new Set(listPublicMerchants("au").map((merchant) => merchant.slug));

    expect(idMerchants.size).toBeGreaterThan(0);
    expect(auMerchants.size).toBeGreaterThan(0);
    for (const slug of auMerchants) {
      expect(idMerchants.has(slug)).toBe(false);
    }
  });

  it("a merchant real in AU is not found under the ID locale", () => {
    const [auSlug] = [...listPublicMerchants("au").map((merchant) => merchant.slug)];
    expect(auSlug).toBeDefined();
    if (auSlug) {
      expect(getPublicMerchant(auSlug, "id")).toBeUndefined();
      expect(getPublicMerchant(auSlug, "au")).toBeDefined();
    }
  });
});
