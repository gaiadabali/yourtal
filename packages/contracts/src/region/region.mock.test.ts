import { describe, expect, it } from "vitest";
import { regionSchema } from "./region";
import {
  REGION_BALANCE_FIXTURES,
  REGION_CAMPAIGN_FIXTURES,
  REGION_LISTING_FIXTURES,
  REGION_VOUCHER_FIXTURES,
} from "./region.mock";

const REGIONS = regionSchema.options;

describe("region mock fixtures", () => {
  it.each(REGIONS)("%s has a sold-out listing", (region) => {
    expect(REGION_LISTING_FIXTURES[region].soldOut.status).toBe("sold_out");
    expect(REGION_LISTING_FIXTURES[region].soldOut.stockRemaining).toBe(0);
  });

  it.each(REGIONS)("%s has a long-merchant-name listing", (region) => {
    expect(REGION_LISTING_FIXTURES[region].longMerchantName.merchantName.length).toBeGreaterThan(
      40,
    );
  });

  it.each(REGIONS)("%s has a long-merchant-name campaign", (region) => {
    expect(REGION_CAMPAIGN_FIXTURES[region].longMerchantName.merchantName.length).toBeGreaterThan(
      40,
    );
  });

  it.each(REGIONS)("%s has an expired voucher", (region) => {
    const { expired } = REGION_VOUCHER_FIXTURES[region];
    expect(expired.status).toBe("expired");
    expect(new Date(expired.expiresAt).getTime()).toBeLessThan(Date.now());
  });

  it.each(REGIONS)("%s has a zero balance", (region) => {
    expect(REGION_BALANCE_FIXTURES[region].zero.availablePoints).toBe(0);
  });

  it.each(REGIONS)("%s has a non-empty catalogue of listings, campaigns and vouchers", (region) => {
    expect(REGION_LISTING_FIXTURES[region].catalogue.length).toBeGreaterThan(0);
    expect(REGION_CAMPAIGN_FIXTURES[region].catalogue.length).toBeGreaterThan(0);
    expect(REGION_VOUCHER_FIXTURES[region].wallet.length).toBeGreaterThan(0);
  });

  it("AU fixtures read as Sydney, not Jakarta", () => {
    const auDistricts = new Set(
      REGION_LISTING_FIXTURES.AU.catalogue.map((listing) => listing.district),
    );
    expect(auDistricts.has("Kemang")).toBe(false);
    expect(REGION_LISTING_FIXTURES.AU.soldOut.district).not.toBe("Kemang");
  });

  it("ID fixtures read as Jakarta, not Sydney", () => {
    const idDistricts = new Set(
      REGION_LISTING_FIXTURES.ID.catalogue.map((listing) => listing.district),
    );
    expect(idDistricts.has("Manly")).toBe(false);
  });
});
