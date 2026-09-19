import type { IdrMinorUnits, Points } from "@yourtal/contracts/money";
import { formatMoney, formatPoints } from "@yourtal/contracts/money/format";

/**
 * Price and date formatting for the Store (YT-0420/YT-0421). Uses
 * `@yourtal/contracts/money/format`, never `@yourtal/contracts/money`,
 * per docs/13b-typescript-standards.md §8's initial-JS budget — see that
 * module's own docstring for why the split exists. Type-only imports of
 * `IdrMinorUnits`/`Points` are free (`verbatimModuleSyntax` erases them).
 *
 * YT-0405: every formatter here takes an optional locale/currency,
 * defaulting to `id-ID`/`IDR` so existing call sites keep rendering exactly
 * what they render today. A screen that has resolved the active region
 * (`apps/web/features/region`) passes its `locale`/`currency` through.
 */
type SupportedLocale = "en-AU" | "id-ID";
type SupportedCurrency = "AUD" | "IDR";

export interface ListingPriceDisplay {
  /** e.g. "5.000 poin" */
  pointsLabel: string;
  /** e.g. "Senilai Rp50.000" — the live face value shown beside the points price. */
  faceValueLabel: string;
}

const WORTH_WORD: Record<SupportedLocale, string> = {
  "en-AU": "Worth",
  "id-ID": "Senilai",
};

/**
 * Formats a listing's points price together with its face value
 * (YT-0420 acceptance: "Price in points shown with the live face value
 * beside it"). Both figures come straight from the listing — this never
 * recomputes a price, it only formats what the catalogue already carries.
 */
export function formatListingPrice(
  priceInPoints: Points,
  faceValueIdr: IdrMinorUnits,
  locale: SupportedLocale = "id-ID",
  currency: SupportedCurrency = "IDR",
): ListingPriceDisplay {
  return {
    pointsLabel: formatPoints(priceInPoints, locale),
    faceValueLabel: `${WORTH_WORD[locale]} ${formatMoney(faceValueIdr, currency)}`,
  };
}

const EXPIRY_DATE_FORMATTERS: Record<SupportedLocale, Intl.DateTimeFormat> = {
  "en-AU": new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }),
  "id-ID": new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }),
};

/**
 * Formats an ISO expiry instant as an absolute date/time, e.g.
 * "19 Sep 2026, 12.00" (`id-ID`) or "19 Sep 2026, 12:00 pm" (`en-AU`).
 * Deliberately absolute rather than a relative "in 3 hours" countdown: a
 * relative label would need `Date.now()` at render time, which risks a
 * server/client mismatch for no real benefit — the listing's own `status`
 * field (docs/09, `listing.ts`) already carries the "expiring soon" signal
 * for the badge (see store-status.ts).
 */
export function formatExpiryDate(expiresAtIso: string, locale: SupportedLocale = "id-ID"): string {
  return EXPIRY_DATE_FORMATTERS[locale].format(new Date(expiresAtIso));
}

const STOCK_NUMBER_FORMATTERS: Record<SupportedLocale, Intl.NumberFormat> = {
  "en-AU": new Intl.NumberFormat("en-AU"),
  "id-ID": new Intl.NumberFormat("id-ID"),
};

const STOCK_REMAINING_WORD: Record<SupportedLocale, string> = {
  "en-AU": "left",
  "id-ID": "tersisa",
};

const SOLD_OUT_WORD: Record<SupportedLocale, string> = {
  "en-AU": "Sold out",
  "id-ID": "Habis",
};

/** e.g. "12 tersisa"/"12 left", or "Habis"/"Sold out" for a sold-out listing. */
export function formatStockRemaining(
  stockRemaining: number,
  locale: SupportedLocale = "id-ID",
): string {
  return stockRemaining > 0
    ? `${STOCK_NUMBER_FORMATTERS[locale].format(stockRemaining)} ${STOCK_REMAINING_WORD[locale]}`
    : SOLD_OUT_WORD[locale];
}
