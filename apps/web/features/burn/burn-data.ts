import type { Listing } from "@yourtal/contracts/listing";
import { listingSchema } from "@yourtal/contracts/listing";
import {
  abovePlausibleBalanceListingFixture,
  expiringSoonListingFixture,
  mockListings,
  soldOutListingFixture,
} from "@yourtal/contracts/listing/mock";
import type { Balance } from "@yourtal/contracts/balance";
import { mixedStateBalanceFixture } from "@yourtal/contracts/balance/mock";
import { pointsPriceFromSettlement, rupiah } from "@yourtal/contracts/money";
import { MOCK_BACKING_RATE_IDR_SEN_PER_POINT } from "@yourtal/contracts/money/mock-backing-rate";
import { resolveDataSource } from "@yourtal/contracts/mock-source";

export interface RedeemData {
  listing: Listing;
  balance: Balance;
}

/**
 * Mirrors `features/store/store-data.ts`'s catalogue exactly: the same 30
 * generated listings plus the same three named fixtures. Sharing it matters
 * — this route is entered from the offer detail page's (YT-0421,
 * `/store/[listingId]`) "Tukar Sekarang" button, so for any id that exists
 * on both routes, this route's price and terms must be the SAME price and
 * terms that page just showed, not a re-derived approximation. An id
 * outside this set 404s here exactly as it does there (see `page.tsx`).
 */
const SHARED_STORE_CATALOGUE: readonly Listing[] = [
  ...mockListings,
  soldOutListingFixture,
  abovePlausibleBalanceListingFixture,
  expiringSoonListingFixture,
];

/** Mirrors the illustrative mock backing rate in `listing.mock.ts` (docs/09 section 4.1). Not the real pricing engine. */
// Rupiah per point. See YT-0506 before changing this.

/**
 * A listing that exists ONLY on this route — not in the shared catalogue
 * above, so `/store/[id]` 404s on it while `/store/[id]/redeem` resolves it
 * directly. It exists purely to make `holdback_blocks`
 * (docs/tasks/phase-u-ui.md YT-0422's fourth acceptance criterion) a
 * guaranteed, stable demo rather than a matter of chance: its price
 * (9,000 points) is deliberately built to sit strictly between
 * `mixedStateBalanceFixture`'s 8,400 available points and its
 * 8,400 + 1,200 = 9,600 points once the pending holdback unlocks (see
 * `burn-errors.ts`'s `classifyBurnEligibility`).
 */
export const holdbackDemoListing: Listing = listingSchema.parse({
  id: "00000000-0000-4000-8000-000000000210",
  merchantId: "00000000-0000-4000-8000-000000000310",
  merchantName: "Griya Kecantikan Melati",
  title: "Paket Perawatan Griya Kecantikan Melati",
  description: "Paket perawatan lengkap — cukup menunggu poin holdback Anda cair untuk menukarnya.",
  category: "services",
  locations: [
    {
      id: "00000001-0000-4000-8000-000000000901",
      name: "Menteng Outlet",
      address: "Jl. Contoh 1",
      district: "Menteng",
    },
  ],
  currency: "IDR",
  faceValueMinor: rupiah(180_000),
  settlementValueMinor: rupiah(54_000),
  priceInPoints: pointsPriceFromSettlement(rupiah(54_000), MOCK_BACKING_RATE_IDR_SEN_PER_POINT),
  stockRemaining: 20,
  stockTotal: 20,
  transferable: false,
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendMinor: null,
  expiresAt: "2026-12-31T00:00:00.000Z",
  status: "available",
});

function findListing(listingId: string): Listing | undefined {
  if (listingId === holdbackDemoListing.id) {
    return holdbackDemoListing;
  }
  return SHARED_STORE_CATALOGUE.find((listing) => listing.id === listingId);
}

interface RedeemDataSource {
  getRedeemData: (listingId: string) => Promise<RedeemData | undefined>;
}

const mockDataSource: RedeemDataSource = {
  getRedeemData: (listingId: string) => {
    const listing = findListing(listingId);
    if (!listing) {
      return Promise.resolve(undefined);
    }
    // The current signed-in user's balance (no auth/session exists in this
    // phase — docs/tasks/phase-u-ui.md preamble). Deliberately the exact
    // same fixture `features/store/store-balance-data.ts` uses for the
    // offer detail page, not an independently chosen one: this route is
    // that page's "Tukar Sekarang" destination, so its affordability
    // verdict for a shared-catalogue listing must match, never merely
    // resemble, what the offer detail page already told the user.
    return Promise.resolve({ listing, balance: mixedStateBalanceFixture });
  },
};

/**
 * No BFF exists yet (Phase U is mock-only). Rather than silently returning
 * mock data under a "live" flag, the live path fails loudly and
 * specifically, so flipping `YOURTAL_DATA_SOURCE=live` demonstrates this
 * route's `error.tsx` honestly instead of faking a failure for a demo.
 */
const liveDataSource: RedeemDataSource = {
  getRedeemData: (listingId: string) =>
    Promise.reject(
      new Error(
        `getRedeemData: no live data source implemented yet (listingId="${listingId}"). Phase U is mock-only.`,
      ),
    ),
};

const redeemDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

/** The listing and the current user's balance for the redeem route, or `undefined` if no such listing exists. */
export function getRedeemData(listingId: string): Promise<RedeemData | undefined> {
  return redeemDataSource.getRedeemData(listingId);
}
