import type { Listing } from "@yourtal/contracts/listing";
import {
  abovePlausibleBalanceListingFixture,
  expiringSoonListingFixture,
  mockListings,
  soldOutListingFixture,
} from "@yourtal/contracts/listing/mock";
import { resolveDataSource } from "@yourtal/contracts/mock-source";

/**
 * The Store's single data-access seam (YT-0420/YT-0421), mirroring
 * `features/campaign/campaign-data.ts`. Server-data-only per
 * docs/13b-typescript-standards.md §8: only `page.tsx` Server Components in
 * `app/(app)/store/**` import this module. Not marked `server-only` for the
 * same reason as its campaign counterpart — that package is not installed
 * in this workspace and this task may not run `pnpm install` — so the
 * boundary is enforced by review instead (no `"use client"` file here
 * imports it).
 *
 * The awkward fixtures (`soldOutListingFixture`,
 * `abovePlausibleBalanceListingFixture`, `expiringSoonListingFixture`) are
 * folded into the catalogue rather than kept test-only, per the brief:
 * "use them, they are built to break your layout."
 */
const mockListingCatalogue: Listing[] = [
  ...mockListings,
  soldOutListingFixture,
  abovePlausibleBalanceListingFixture,
  expiringSoonListingFixture,
];

interface StoreDataSource {
  listListings: () => Promise<Listing[]>;
  getListing: (listingId: string) => Promise<Listing | undefined>;
}

const mockDataSource: StoreDataSource = {
  listListings: () => Promise.resolve(mockListingCatalogue),
  getListing: (listingId: string) => Promise.resolve(mockListingCatalogue.find((listing) => listing.id === listingId)),
};

/**
 * No BFF exists yet (Phase U is mock-only). Rather than silently returning
 * mock data under a "live" flag, the live path fails loudly and
 * specifically, so flipping `YOURTAL_DATA_SOURCE=live` demonstrates this
 * route's `error.tsx` honestly instead of faking a failure for a demo.
 */
const liveDataSource: StoreDataSource = {
  listListings: () => Promise.reject(new Error("Live store data source is not implemented yet (Phase U is mock-only).")),
  getListing: () => Promise.reject(new Error("Live store data source is not implemented yet (Phase U is mock-only).")),
};

const storeDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

/** All store listings, unfiltered. */
export function listListings(): Promise<Listing[]> {
  return storeDataSource.listListings();
}

/** A single listing for the offer detail page, or `undefined` if no such listing exists. */
export function getListing(listingId: string): Promise<Listing | undefined> {
  return storeDataSource.getListing(listingId);
}
