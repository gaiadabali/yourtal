import { describe, expect, it } from "vitest";
import { MOCK_MERCHANTS, mockMerchantById, mockMerchantsInRegion } from "./merchant-roster";
import { mockCampaigns, zeroRewardCampaignFixture } from "../campaign/campaign.mock";
import {
  abovePlausibleBalanceListingFixture,
  expiringSoonListingFixture,
  mockListings,
  soldOutListingFixture,
} from "../listing/listing.mock";
import {
  expiredVoucherFixture,
  expiringWithinHourVoucherFixture,
  mockVouchers,
} from "../voucher/voucher.mock";
import { generateAuCampaigns } from "../region/region-mock-au-campaign";
import { generateAuListings } from "../region/region-mock-au-listing";
import {
  auExpiredVoucherFixture,
  auExpiringWithinHourVoucherFixture,
  generateAuVouchers,
} from "../region/region-mock-au-voucher";

/**
 * The guard behind `merchant-roster.ts`.
 *
 * The bug it replaces was not a wrong value — it was two files that never
 * agreed on who a merchant is, each of them internally consistent. That is
 * invisible to a reader of either file, so the check has to be the one thing
 * neither file can state alone: **every merchant any mock mentions is a
 * merchant the counter can actually be provisioned as.**
 */

interface MerchantBearing {
  readonly merchantId: string;
  readonly merchantName: string;
}

/** Everything in this package that names a merchant. */
function everythingWithAMerchant(): MerchantBearing[] {
  return [
    ...mockCampaigns,
    ...mockListings,
    ...mockVouchers,
    ...generateAuCampaigns(8, 7_100),
    ...generateAuListings(8, 7_200),
    ...generateAuVouchers(8, 7_300),
    zeroRewardCampaignFixture,
    soldOutListingFixture,
    abovePlausibleBalanceListingFixture,
    expiringSoonListingFixture,
    expiredVoucherFixture,
    expiringWithinHourVoucherFixture,
    auExpiredVoucherFixture,
    auExpiringWithinHourVoucherFixture,
  ];
}

describe("the mock merchant roster", () => {
  it("has a unique id, name and provisioning code per merchant", () => {
    const ids = MOCK_MERCHANTS.map((merchant) => merchant.id);
    const names = MOCK_MERCHANTS.map((merchant) => merchant.name);
    const codes = MOCK_MERCHANTS.map((merchant) => merchant.provisioningCode);

    expect(ids).toStrictEqual([...new Set(ids)]);
    // Two merchants sharing a name is what produced
    // "Voucher untuk Toko Berkah, bukan Toko Berkah" on a counter screen.
    expect(names).toStrictEqual([...new Set(names)]);
    expect(codes).toStrictEqual([...new Set(codes)]);
  });

  it("can provision a counter for every merchant it lists", () => {
    for (const merchant of MOCK_MERCHANTS) {
      expect(merchant.provisioningCode.length).toBeGreaterThan(0);
      expect(merchant.counterLabel.length).toBeGreaterThan(0);
    }
  });

  it("has merchants in both regions", () => {
    expect(mockMerchantsInRegion("ID").length).toBeGreaterThan(0);
    expect(mockMerchantsInRegion("AU").length).toBeGreaterThan(0);
  });

  /**
   * The contract with `apps/web/features/merchant/provisioning/provisioning-data.ts`,
   * which hard codes these three. That file belongs to another session; until
   * it derives its codes from this roster, this test is what stops the two
   * drifting back apart — and it names the file so the next person to change
   * either one knows where the other is.
   */
  it.each([
    { id: "00000000-0000-4000-8000-000000000601", name: "Toko Berkah", code: "TOKO-BERKAH-1" },
    {
      id: "00000000-0000-4000-8000-000000000602",
      name: "Kopi Kenangan Kemang",
      code: "KEMANG-COUNTER-2",
    },
    { id: "00000000-0000-4000-8000-000000000603", name: "Sydney CBD Cafe", code: "SYDNEY-CBD-1" },
  ])("keeps $name aligned with provisioning-data.ts", ({ id, name, code }) => {
    expect(mockMerchantById(id)).toMatchObject({ name, provisioningCode: code });
  });
});

describe("every mock merchant is a redeemable one", () => {
  /**
   * The regression. `merchantId` was `faker.string.uuid()`, so no generated
   * voucher could ever match a provisioned counter and every redemption in
   * the prototype returned `wrong_merchant`.
   */
  it("never names a merchant that is not on the roster", () => {
    const strangers = everythingWithAMerchant()
      .filter((item) => mockMerchantById(item.merchantId) === undefined)
      .map((item) => `${item.merchantName} (${item.merchantId})`);

    expect([...new Set(strangers)]).toStrictEqual([]);
  });

  /**
   * The other direction, and the one the fixtures actually got wrong twice:
   * `…03a1` carried "Wharf Espresso Co" in one fixture and "Cedar Deli Bar"
   * in another, and `…0302` was the long name in listings but "Toko Berkah"
   * in vouchers. A shared id with two names is worse than two ids sharing a
   * name, because an id is what authorizes a redemption.
   */
  it("always spells a merchant's name the way the roster does", () => {
    const misspelt = everythingWithAMerchant()
      .filter((item) => mockMerchantById(item.merchantId)?.name !== item.merchantName)
      .map((item) => `${item.merchantId} is "${item.merchantName}"`);

    expect([...new Set(misspelt)]).toStrictEqual([]);
  });
});
