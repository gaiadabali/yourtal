import type { Region } from "./region";
import type { Listing } from "../listing/listing";
import type { Campaign } from "../campaign/campaign";
import type { Voucher } from "../voucher/voucher";
import type { Balance } from "../balance/balance";
import {
  abovePlausibleBalanceListingFixture,
  generateListings,
  soldOutListingFixture,
} from "../listing/listing.mock";
import { generateCampaigns, longMerchantNameCampaignFixture } from "../campaign/campaign.mock";
import {
  expiredVoucherFixture,
  expiringWithinHourVoucherFixture,
  generateVouchers,
} from "../voucher/voucher.mock";
import { zeroBalanceFixture } from "../balance/balance.mock";
import {
  auExpiredVoucherFixture,
  auExpiringWithinHourVoucherFixture,
  auLongMerchantNameCampaignFixture,
  auLongMerchantNameListingFixture,
  auSoldOutListingFixture,
  generateAuCampaigns,
  generateAuListings,
  generateAuVouchers,
} from "./region-mock-au";

/**
 * Region-scoped mock fixtures for both AU and ID (YT-0405 acceptance:
 * "Mock fixtures exist for both regions — Sydney merchants and AUD prices
 * alongside the Jakarta/IDR set — including the same awkward cases").
 *
 * ID's side reuses the existing generators/fixtures in `listing.mock.ts`,
 * `campaign.mock.ts`, `voucher.mock.ts` and `balance.mock.ts` rather than
 * duplicating them — this file's job is pairing them with their AU
 * counterparts (`region-mock-au.ts`), not re-inventing Jakarta data that
 * already exists and is used elsewhere.
 *
 * A screen picks its data by the active region, never by hand:
 * `REGION_LISTING_FIXTURES[region].catalogue`.
 */
export interface RegionalListingFixtures {
  readonly soldOut: Listing;
  /** Long merchant name, for 320px-viewport checks. */
  readonly longMerchantName: Listing;
  readonly catalogue: readonly Listing[];
}

export interface RegionalCampaignFixtures {
  readonly longMerchantName: Campaign;
  readonly catalogue: readonly Campaign[];
}

export interface RegionalVoucherFixtures {
  readonly expired: Voucher;
  readonly expiringWithinHour: Voucher;
  readonly wallet: readonly Voucher[];
}

export const REGION_LISTING_FIXTURES: Record<Region, RegionalListingFixtures> = {
  ID: {
    soldOut: soldOutListingFixture,
    longMerchantName: abovePlausibleBalanceListingFixture,
    catalogue: generateListings(12, 9_100),
  },
  AU: {
    soldOut: auSoldOutListingFixture,
    longMerchantName: auLongMerchantNameListingFixture,
    catalogue: generateAuListings(12, 9_200),
  },
};

export const REGION_CAMPAIGN_FIXTURES: Record<Region, RegionalCampaignFixtures> = {
  ID: {
    longMerchantName: longMerchantNameCampaignFixture,
    catalogue: generateCampaigns(12, 9_300),
  },
  AU: {
    longMerchantName: auLongMerchantNameCampaignFixture,
    catalogue: generateAuCampaigns(12, 9_400),
  },
};

export const REGION_VOUCHER_FIXTURES: Record<Region, RegionalVoucherFixtures> = {
  ID: {
    expired: expiredVoucherFixture,
    expiringWithinHour: expiringWithinHourVoucherFixture,
    wallet: generateVouchers(8, 9_500),
  },
  AU: {
    expired: auExpiredVoucherFixture,
    expiringWithinHour: auExpiringWithinHourVoucherFixture,
    wallet: generateAuVouchers(8, 9_600),
  },
};

/**
 * A zero balance is currency-agnostic — `Balance` carries only points, never
 * an amount in a region's currency — so the same fixture genuinely serves
 * both regions rather than needing an AU-flavoured duplicate.
 */
export const REGION_BALANCE_FIXTURES: Record<Region, { readonly zero: Balance }> = {
  ID: { zero: zeroBalanceFixture },
  AU: { zero: zeroBalanceFixture },
};
