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
 * and do not add a schema to this file.
 */
import type { IdrMinorUnits, Points } from "./money";

/**
 * Formats a stored IDR amount for display, e.g. `45_000` renders as
 * "Rp45.000".
 *
 * There is no division here because `IdrMinorUnits` is currently a count of
 * Rupiah, not sen (see money.ts, and YT-0506 which has not settled). If that
 * decision lands on sen, THIS is the one place display must divide by 100 —
 * which is why the duplicate copy of this function was deleted from money.ts.
 */
export function formatIdr(amount: IdrMinorUnits): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Formats a points amount for display, e.g. `2.400 poin`. */
export function formatPoints(amount: Points): string {
  return `${new Intl.NumberFormat("id-ID").format(amount)} poin`;
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
