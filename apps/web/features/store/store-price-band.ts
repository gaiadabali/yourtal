import type { Listing } from "@yourtal/contracts/listing";
import { getStoreTranslator, type SupportedLocale } from "./store-i18n";

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
  minPoints: number;
  /** Exclusive upper bound; `null` means unbounded above. */
  maxPointsExclusive: number | null;
}

const PRICE_BAND_BOUNDS: readonly PriceBandBounds[] = [
  { key: "under_2500", minPoints: 0, maxPointsExclusive: 2_500 },
  { key: "2500_5000", minPoints: 2_500, maxPointsExclusive: 5_000 },
  { key: "5000_10000", minPoints: 5_000, maxPointsExclusive: 10_000 },
  { key: "over_10000", minPoints: 10_000, maxPointsExclusive: null },
];

// `as const` matters: the translator's key parameter is a union of literal
// message paths, so a `Record<_, string>` widens these to `string` and stops
// type-checking the very thing the map exists to keep correct.
const BAND_MESSAGE_KEY = {
  under_2500: "store.bandUnder2500",
  "2500_5000": "store.band2500to5000",
  "5000_10000": "store.band5000to10000",
  over_10000: "store.bandOver10000",
} as const satisfies Record<StorePriceBandKey, string>;

/**
 * Every price-band filter option, translated for `locale`.
 *
 * YT-0405: the bounds are data and the labels are copy, and they used to be
 * the same object — which is why a band could not be renamed for one region
 * without editing the number it filters on. `locale` is required, the same
 * call this module's siblings (`store-category.ts`, `store-status.ts`) now
 * take.
 */
export function storePriceBandFilterOptions(
  locale: SupportedLocale,
): ReadonlyArray<{ key: StorePriceBandFilter; label: string }> {
  const t = getStoreTranslator(locale);
  return [
    { key: "all", label: t("store.bandAll") },
    ...PRICE_BAND_BOUNDS.map((band) => ({ key: band.key, label: t(BAND_MESSAGE_KEY[band.key]) })),
  ];
}

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
