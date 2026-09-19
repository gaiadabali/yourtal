import type { Listing } from "@yourtal/contracts/listing";

/**
 * Price-band filter for the Store browse grid (YT-0420 acceptance:
 * "category, merchant, price-band and location filters"). Bands are a
 * presentation grouping over `priceInPoints`, not a contract concept, so
 * they live here rather than in `packages/contracts` — the same reasoning
 * `campaign-reward-split.ts` documents for its own mock-only ratio.
 *
 * Bounds are chosen against the mock catalogue's actual spread (roughly
 * 750-20,000 points for ordinary listings, docs/09 §4.1's worked example),
 * plus a top band wide enough to also catch `abovePlausibleBalanceListingFixture`
 * (1,500,000 points) without a fifth, near-empty band.
 */
const STORE_PRICE_BAND_KEYS = ["under_2500", "2500_5000", "5000_10000", "over_10000"] as const;
export type StorePriceBandKey = (typeof STORE_PRICE_BAND_KEYS)[number];

export const STORE_PRICE_BAND_FILTER_VALUES = ["all", ...STORE_PRICE_BAND_KEYS] as const;
export type StorePriceBandFilter = (typeof STORE_PRICE_BAND_FILTER_VALUES)[number];

export const DEFAULT_STORE_PRICE_BAND_FILTER: StorePriceBandFilter = "all";

interface PriceBandBounds {
  key: StorePriceBandKey;
  label: string;
  minPoints: number;
  /** Exclusive upper bound; `null` means unbounded above. */
  maxPointsExclusive: number | null;
}

const PRICE_BAND_BOUNDS: readonly PriceBandBounds[] = [
  { key: "under_2500", label: "Di bawah 2.500 poin", minPoints: 0, maxPointsExclusive: 2_500 },
  { key: "2500_5000", label: "2.500-5.000 poin", minPoints: 2_500, maxPointsExclusive: 5_000 },
  { key: "5000_10000", label: "5.000-10.000 poin", minPoints: 5_000, maxPointsExclusive: 10_000 },
  { key: "over_10000", label: "Di atas 10.000 poin", minPoints: 10_000, maxPointsExclusive: null },
];

export const STORE_PRICE_BAND_FILTER_OPTIONS: ReadonlyArray<{
  key: StorePriceBandFilter;
  label: string;
}> = [
  { key: "all", label: "Semua harga" },
  ...PRICE_BAND_BOUNDS.map((band) => ({ key: band.key, label: band.label })),
];

export function isStorePriceBandFilter(value: string): value is StorePriceBandFilter {
  return (STORE_PRICE_BAND_FILTER_VALUES as readonly string[]).includes(value);
}

export function filterListingsByPriceBand(
  listings: readonly Listing[],
  priceBand: StorePriceBandFilter,
): Listing[] {
  if (priceBand === "all") {
    return [...listings];
  }
  const bounds = PRICE_BAND_BOUNDS.find((band) => band.key === priceBand);
  if (!bounds) {
    return [...listings];
  }
  return listings.filter(
    (listing) =>
      listing.priceInPoints >= bounds.minPoints &&
      (bounds.maxPointsExclusive === null || listing.priceInPoints < bounds.maxPointsExclusive),
  );
}
