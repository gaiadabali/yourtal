import { describe, expect, it } from "vitest";
import { buildNewListingBody, emptyListingValues, expiryInstant } from "./listing-form";
import type { ListingFormValues } from "./listing-form";

const NOW = new Date("2026-10-07T00:00:00");

function filled(overrides: Partial<ListingFormValues> = {}): ListingFormValues {
  return {
    ...emptyListingValues(),
    title: "Flat white",
    description: "One flat white at the counter.",
    imageUrl: "https://images.example/flat-white.jpg",
    faceValue: "10.50",
    settlementValue: "7",
    stockTotal: "25",
    locationIds: ["7a1f6a58-0f35-4a56-9d0f-3a6d3f3f4f01"],
    expiresOn: "2026-12-31",
    ...overrides,
  };
}

describe("buildNewListingBody", () => {
  it("converts typed AUD amounts to exact cents and sends no price", () => {
    const result = buildNewListingBody(filled(), {
      currency: "AUD",
      merchantName: "Cafe",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.faceValueMinor).toBe(1050);
    expect(result.body.settlementValueMinor).toBe(700);
    expect(result.body.stockTotal).toBe(25);
    expect(result.body.merchantName).toBe("Cafe");
    expect(result.body).not.toHaveProperty("priceInPoints");
    expect(result.body.partialRedemption).toBe("single_use");
  });

  it("treats rupiah as whole units and refuses decimals", () => {
    const ok = buildNewListingBody(filled({ faceValue: "50000", settlementValue: "35000" }), {
      currency: "IDR",
      merchantName: "Warung",
      now: NOW,
    });
    expect(ok.ok && ok.body.faceValueMinor).toBe(50_000);
    const bad = buildNewListingBody(filled({ faceValue: "50000.5", settlementValue: "35000" }), {
      currency: "IDR",
      merchantName: "Warung",
      now: NOW,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.faceValue).toBe("amount");
  });

  it("refuses S above the face value, no stock, no location, a bad link and a past expiry", () => {
    const result = buildNewListingBody(
      filled({
        settlementValue: "11",
        stockTotal: "0",
        locationIds: [],
        imageUrl: "not a link",
        expiresOn: "2026-01-01",
      }),
      { currency: "AUD", merchantName: "Cafe", now: NOW },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      settlementValue: "settlementAboveFace",
      stockTotal: "stock",
      locationIds: "locations",
      imageUrl: "url",
      expiresOn: "expiry",
    });
  });

  it("needs a minimum spend only for that policy, and maps the policy to the counter wording", () => {
    const missing = buildNewListingBody(filled({ partialPolicy: "minimum_spend" }), {
      currency: "AUD",
      merchantName: "Cafe",
      now: NOW,
    });
    expect(missing.ok).toBe(false);
    const carrying = buildNewListingBody(filled({ partialPolicy: "balance_carrying" }), {
      currency: "AUD",
      merchantName: "Cafe",
      now: NOW,
    });
    expect(carrying.ok && carrying.body.partialRedemption).toBe("balance_carries");
    expect(carrying.ok && carrying.body.minimumSpendMinor).toBeNull();
    const spend = buildNewListingBody(
      filled({ partialPolicy: "minimum_spend", minimumSpend: "5" }),
      { currency: "AUD", merchantName: "Cafe", now: NOW },
    );
    expect(spend.ok && spend.body.minimumSpendMinor).toBe(500);
  });
});

describe("expiryInstant", () => {
  it("is the end of the chosen day, and null for the past or junk", () => {
    expect(expiryInstant("2026-12-31", NOW)).not.toBeNull();
    expect(expiryInstant("2026-10-06", NOW)).toBeNull();
    expect(expiryInstant("", NOW)).toBeNull();
    expect(expiryInstant("31/12/2026", NOW)).toBeNull();
  });
});
