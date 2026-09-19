import type { IdrMinorUnits, Points } from "@yourtal/contracts/money";
import { formatIdr, formatPoints } from "@yourtal/contracts/money/format";

/**
 * Price and date formatting for the Store (YT-0420/YT-0421). Uses
 * `@yourtal/contracts/money/format`, never `@yourtal/contracts/money`,
 * per docs/13b-typescript-standards.md §8's initial-JS budget — see that
 * module's own docstring for why the split exists. Type-only imports of
 * `IdrMinorUnits`/`Points` are free (`verbatimModuleSyntax` erases them).
 */
export interface ListingPriceDisplay {
  /** e.g. "5.000 poin" */
  pointsLabel: string;
  /** e.g. "Senilai Rp50.000" — the live face value shown beside the points price. */
  faceValueLabel: string;
}

/**
 * Formats a listing's points price together with its face value
 * (YT-0420 acceptance: "Price in points shown with the live face value
 * beside it"). Both figures come straight from the listing — this never
 * recomputes a price, it only formats what the catalogue already carries.
 */
export function formatListingPrice(priceInPoints: Points, faceValueIdr: IdrMinorUnits): ListingPriceDisplay {
  return {
    pointsLabel: formatPoints(priceInPoints),
    faceValueLabel: `Senilai ${formatIdr(faceValueIdr)}`,
  };
}

const expiryDateFormatter = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

/**
 * Formats an ISO expiry instant as an absolute Indonesian date/time, e.g.
 * "19 Sep 2026, 12.00". Deliberately absolute rather than a relative
 * "in 3 hours" countdown: a relative label would need `Date.now()` at
 * render time, which risks a server/client mismatch for no real benefit —
 * the listing's own `status` field (docs/09, `listing.ts`) already carries
 * the "expiring soon" signal for the badge (see store-status.ts).
 */
export function formatExpiryDate(expiresAtIso: string): string {
  return expiryDateFormatter.format(new Date(expiresAtIso));
}

/** e.g. "12 tersisa" or "Habis" for a sold-out listing. */
export function formatStockRemaining(stockRemaining: number): string {
  return stockRemaining > 0 ? `${new Intl.NumberFormat("id-ID").format(stockRemaining)} tersisa` : "Habis";
}
