/**
 * Display formatting for money and points — deliberately dependency-free.
 *
 * This module is split out from `money.ts` because that file defines the Zod
 * schemas, and Zod is ~100 KB gz. Any client component that value-imported
 * `formatPoints` from `money.ts` dragged the whole Zod runtime into its
 * bundle, which is exactly what blew the 170 KB initial-JS budget
 * (docs/13b-typescript-standards.md section 8) on `/` and `/watch/[campaignId]`.
 *
 * `./currency` and `./minor-unit` are value-imported and that is safe: both
 * are Zod-free for this reason. `money.ts` and `money-value.ts` are imported
 * `import type` only, and `verbatimModuleSyntax` is on, so those imports are
 * erased at compile time and this module has NO runtime edge to either.
 * Keep it that way: do not value-import a schema here, and do not add one.
 *
 * ## What YT-0513 changed here
 *
 * This file used to spell out `"AUD" | "IDR"` by hand and divide AUD by a
 * literal 100, with a comment explaining that it could not import the region
 * table without taking on Zod. That was true, and the answer was not to keep
 * a well-commented copy — it was to make the thing importable. The union now
 * comes from `./currency` and the divisor from `./minor-unit`, so the IDR
 * question (YT-0506) has exactly one place to be answered instead of being
 * restated in prose here.
 */
import type { Currency } from "./currency";
import { minorUnitExponent } from "./minor-unit";
import type { MinorUnits, Points } from "./money";
import type { Money } from "./money-value";

/** The two locales this platform renders in (docs/15: `id-ID`, `en-AU`, locked). */
type SupportedLocale = "en-AU" | "id-ID";

const CURRENCY_LOCALE: Record<Currency, SupportedLocale> = {
  AUD: "en-AU",
  IDR: "id-ID",
};

/**
 * Formats a stored minor-unit amount for display, e.g.
 * `formatMoney(toIdrMinorUnits(45_000), "IDR")` renders "Rp45.000" and
 * `formatMoney(toIdrMinorUnits(1_250), "AUD")` renders "$12.50".
 *
 * The scaling comes from `MINOR_UNIT`: AUD is exponent 2, so its integer is
 * cents; IDR is exponent 0 today, so its integer renders as written. When
 * YT-0506 settles, changing that one table changes this function, and
 * nothing here needs editing.
 *
 * It formats a **provisional** unit rather than refusing to. Display is not
 * settlement: a wrong exponent renders a wrong number, while a wrong
 * exponent at a PSP settles a merchant 100x wrong. `assertUnitSettled` gates
 * the second and deliberately does not gate this one — a guard that breaks
 * every working screen is a guard somebody removes.
 *
 * The amount is still typed `IdrMinorUnits` because the schemas it is read
 * from are: migrating those fields to `Money` is a wire change coordinated
 * separately. `formatMoneyValue` is the version for amounts that already
 * know their own currency, and is what new call sites should use.
 */
export function formatMoney(amountMinor: MinorUnits, currency: Currency): string {
  const exponent = minorUnitExponent(currency);
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency], {
    style: "currency",
    currency,
    maximumFractionDigits: exponent,
  }).format(amountMinor / 10 ** exponent);
}

/**
 * Formats a `Money`, which carries its own currency (YT-0513).
 *
 * The one-argument form that `formatMoney` cannot be: there is no currency
 * for the caller to get wrong, and no AU fixture that renders as Rupiah
 * because somebody forgot the second argument.
 */
export function formatMoneyValue(value: Money): string {
  return formatMoney(asDisplayIdr(value.amountMinor), value.currency);
}

/**
 * Formats a stored IDR amount for display, e.g. `45_000` renders as
 * "Rp45.000". Kept because existing call sites still call it by name; it is
 * now a thin alias for `formatMoney(amount, "IDR")` so there is one
 * formatting implementation, not two that can drift. New call sites that
 * know their region's currency should call `formatMoney` directly.
 */
export function formatIdr(amount: MinorUnits): string {
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
 * Deprecated (1.7.d) — prose only, deliberately NOT a `@deprecated` JSDoc
 * tag: `@typescript-eslint/no-deprecated` is type-aware and repo-wide, and
 * B's and C's call sites are only scheduled to move off this function in
 * 6.1.c, 7.8.c and 8.2.d — a real tag would fail `pnpm check` on `main` for
 * every session until then, over a call this ticket does not own. Call
 * `formatPointsIn(locale, amount)` instead, which takes no default.
 * Defaulting a locale is exactly the AU-first bug F2 exists to prevent — a
 * screen that forgets to pass one silently renders the other region's
 * language. Kept only for call sites not yet moved; its default is `en-AU`
 * (0.5.a: AU, not ID, is the platform default) rather than the old `id-ID`,
 * so an un-migrated call site now fails towards the current default region
 * instead of the old one.
 */
export function formatPoints(amount: Points, locale: SupportedLocale = "en-AU"): string {
  return formatPointsIn(locale, amount);
}

/**
 * Formats a points amount for display with an explicit locale — the
 * replacement for the deprecated `formatPoints`. No default: a caller that
 * does not know its locale must get it from `apps/web/features/region`
 * (or an equivalent per area) rather than silently rendering the wrong
 * region's language (1.7.d).
 */
export function formatPointsIn(locale: SupportedLocale, amount: Points): string {
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
export function asDisplayIdr(value: number): MinorUnits {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- display-only brand, never on the value path, YT-0412
  return value as MinorUnits;
}
