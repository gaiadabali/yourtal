import type { Listing } from "@yourtal/contracts/listing";

/**
 * Display helpers for a listing's `locations[]` (YT-0502, which replaced a
 * single `district: string`).
 *
 * **The rule these exist to enforce: never render a multi-branch merchant as
 * if it had one branch.** The old field could only ever name one district, so
 * every surface that showed it was implicitly claiming exclusivity it had no
 * basis for. Dropping `locations[0].district` in where `district` used to sit
 * would keep that bug and hide it behind a passing typecheck — the listing
 * would look single-site, and a user who travelled to the one district named
 * would have no way to learn the other two existed.
 *
 * Which branch actually honours a voucher is load-bearing for redemption and
 * for disputes, so the compact label is deliberately *lossy but honest*: it
 * names one district and admits to the rest, rather than naming one and
 * implying there are no others. Detail surfaces, where there is room, show
 * the full set instead — see `listingDistricts`.
 */
type SupportedLocale = "en-AU" | "id-ID";

/** Every distinct district this listing can be redeemed in, alphabetised. */
export function listingDistricts(listing: Listing, locale: SupportedLocale = "id-ID"): string[] {
  return Array.from(new Set(listing.locations.map((location) => location.district))).sort((a, b) =>
    a.localeCompare(b, locale),
  );
}

/**
 * A compact label for cards and meta rows: `"Kemang"` for one district,
 * `"Kemang +2"` for three. The suffix counts *districts*, not outlets — two
 * branches in Kemang are one place to go, and inflating that to "+1" would
 * overstate reach.
 */
export function listingDistrictLabel(listing: Listing, locale: SupportedLocale = "id-ID"): string {
  const districts = listingDistricts(listing, locale);
  const [first, ...rest] = districts;
  if (first === undefined) {
    // `locations` is `.min(1)` in the contract, so this is unreachable through
    // a parsed listing. Returning "" rather than throwing keeps a card that
    // somehow received unparsed data rendering as incomplete instead of
    // taking the whole grid down with it.
    return "";
  }
  return rest.length === 0 ? first : `${first} +${String(rest.length)}`;
}

/** Whether this listing can be redeemed in `district` at any of its locations. */
export function listingHasDistrict(listing: Listing, district: string): boolean {
  return listing.locations.some((location) => location.district === district);
}
