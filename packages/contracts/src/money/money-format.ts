/**
 * Display formatting for money and points — deliberately dependency-free.
 *
 * This module is split out from `money.ts` because that file defines the Zod
 * schemas, and Zod is ~100 KB gz. Any client component that value-imported
 * `formatPoints` from `money.ts` dragged the whole Zod runtime into its
 * bundle, which is exactly what blew the 170 KB initial-JS budget
 * (docs/13b-typescript-standards.md section 8) on `/` and `/watch/[campaignId]`.
 *
 * The imports below are `import type`, and `verbatimModuleSyntax` is on, so
 * they are erased at compile time and this module has NO runtime edge to
 * `money.ts`. Keep it that way: do not import a value from `money.ts` here,
 * and do not add a schema to this file. The same rule applies to
 * `@yourtal/contracts/region` — it exports `regionSchema` (Zod) alongside
 * `REGION_CONFIG`, so this file never imports it either, even type-only for
 * the locale/currency unions: they are spelled out as literal unions below.
 */
import type { IdrMinorUnits, Points } from "./money";

/** The two locales this platform renders in (docs/15: `id-ID`, `en-AU`, locked). */
type SupportedLocale = "en-AU" | "id-ID";
/** The two currencies a region can price in (docs/tasks/phase-u-ui.md YT-0405). */
type SupportedCurrency = "AUD" | "IDR";

const CURRENCY_LOCALE: Record<SupportedCurrency, SupportedLocale> = {
  AUD: "en-AU",
  IDR: "id-ID",
};

/**
 * Formats a stored minor-unit amount as a currency string for display, e.g.
 * `formatMoney(toIdrMinorUnits(45_000), "IDR")` renders "Rp45.000" and
 * `formatMoney(toIdrMinorUnits(1_250), "AUD")` renders "$12.50".
 *
 * AUD is unambiguously two-decimal, so its minor unit (cents) is divided by
 * 100 here. IDR is NOT divided: `IdrMinorUnits` is currently a count of whole
 * Rupiah, not sen (see money.ts's header, and YT-0506 which has not settled
 * that question). If YT-0506 ever redefines the IDR minor unit, the IDR
 * branch below is the one place that division goes — there remains exactly
 * one formatting implementation to change, which is the whole reason this
 * function (and this module) exists.
 *
 * The parameter is still typed `IdrMinorUnits` rather than a currency-generic
 * brand: `packages/contracts` has no currency-tagged Money type yet (docs/12
 * section 3's Fowler Money pattern, raised with the architect against
 * money.ts) — this function's signature is deliberately no wider than that
 * gap requires. It works correctly for both currencies today because both
 * are, structurally, "an integer amount in the currency's minor unit."
 */
export function formatMoney(amountMinor: IdrMinorUnits, currency: SupportedCurrency): string {
  const locale = CURRENCY_LOCALE[currency];
  if (currency === "AUD") {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "AUD" }).format(
      amountMinor / 100,
    );
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amountMinor);
}

/**
 * Formats a stored IDR amount for display, e.g. `45_000` renders as
 * "Rp45.000". Kept because existing call sites still call it by name; it is
 * now a thin alias for `formatMoney(amount, "IDR")` so there is one
 * formatting implementation, not two that can drift. New call sites that
 * know their region's currency should call `formatMoney` directly.
 */
export function formatIdr(amount: IdrMinorUnits): string {
  return formatMoney(amount, "IDR");
}

const POINTS_WORD: Record<SupportedLocale, string> = {
  "en-AU": "points",
  "id-ID": "poin",
};

/**
 * Formats a points amount for display, e.g. "2.400 poin" (`id-ID`) or
 * "2,400 points" (`en-AU`). Points are the platform's own currency (docs/09)
 * and are never converted between regions, so this only changes the number
 * grouping and the word, never the quantity.
 *
 * Defaults to `id-ID` so call sites not yet updated to pass the active
 * region's locale keep rendering exactly what they render today, rather than
 * silently breaking — see `apps/web/features/region` for how a screen gets
 * its locale without prop-drilling.
 */
export function formatPoints(amount: Points, locale: SupportedLocale = "id-ID"): string {
  return `${new Intl.NumberFormat(locale).format(amount)} ${POINTS_WORD[locale]}`;
}

/**
 * Unchecked brands, for DISPLAY CALL SITES ONLY.
 *
 * `toPoints` / `toIdrMinorUnits` in `money.ts` run a Zod schema, which is the
 * correct thing at a process boundary and the wrong thing in a client
 * component that just wants to render a number it was handed as a prop.
 * Paying ~100 KB gz of Zod to format a string is what put `/` and
 * `/watch/[campaignId]` over the initial-JS budget.
 *
 * These assert the brand without validating. That is safe HERE because a
 * display component cannot act on the value — a wrong number renders wrong
 * either way, and nothing downstream of a formatter touches the ledger.
 *
 * NEVER use these on the value path (ledger, pricing, voucher, redemption,
 * clearing). There, an unvalidated amount is exactly the bug the brand
 * exists to catch — use `toPoints` / `toIdrMinorUnits` and parse properly.
 */
export function asDisplayPoints(value: number): Points {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- display-only brand, never on the value path, YT-0412
  return value as Points;
}

/** Unchecked IDR brand for display call sites. See `asDisplayPoints`. */
export function asDisplayIdr(value: number): IdrMinorUnits {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- display-only brand, never on the value path, YT-0412
  return value as IdrMinorUnits;
}
