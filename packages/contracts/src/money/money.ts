import { z } from "zod";

/**
 * Money and points, the foundation every other schema in this package builds on.
 *
 * **The IDR minor unit is currently 1 Rupiah** — an `idrMinorUnitsSchema`
 * value is a count of Rupiah, and Rp 45.000 is stored as `45_000`.
 *
 * THIS IS NOT SETTLED. `docs/12` section 3, `docs/18` line 24 and YT-0041's
 * acceptance criteria all say IDR must be stored in **sen (x100)**, because
 * Stripe and most PSPs treat IDR as a two-decimal currency, and YT-0041 calls
 * a mismatch here "a 100x error". The deciding fact does not settle from
 * documentation: ISO 4217 gives IDR a sen minor unit, Adyen explicitly flags
 * IDR as diverging from its own table, and Xendit does not document it
 * publicly. Tracked as **YT-0506 (blocked)**; YT-0041 must not be implemented
 * until it is decided. Do NOT "fix" this file to sen without that decision.
 *
 * The deeper problem is that this type has no currency at all. YourTal runs
 * two regions, Australia and Indonesia, each with its own currency, tax and
 * regulatory setup — and `docs/12` section 3 already specifies Fowler's Money
 * pattern, `(int64 amount_minor, currency)`, which this file does not
 * implement. AUD is unambiguously two-decimal; only IDR is in question. A
 * currency-tagged Money type would let AUD proceed while IDR stays pending,
 * and would make "IDR is stored in X" a per-processor conversion rather than
 * a global rule. Raised with the architect.
 *
 * Points are the platform's own currency (docs/09, docs/07 section 2.1) and
 * are likewise always non-negative integers — there is no fractional point.
 *
 * FORMATTING LIVES IN `money-format.ts`, not here. That module is
 * dependency-free so client components can format without pulling in Zod,
 * and keeping a second copy of `formatIdr` here would mean two places to
 * change if the IDR minor unit is ever redefined — which YT-0506 may still
 * do. There was a second, dead copy here once, unimported and therefore
 * invisible; it would have been missed by exactly that redefinition. There
 * must be exactly one implementation to change.
 *
 * Both types are Zod branded types: the only way to obtain a value typed as
 * `IdrMinorUnits` or `Points` is to run a number through the corresponding
 * schema's `parse`/`safeParse`. There is no cast that manufactures one, by
 * design — that is what makes the brand meaningful.
 */

// IDR 10 billion. Beyond int32, which is why src/openapi/build-document.ts
// widens money fields to int64 for Go.
const MAX_SAFE_IDR_MINOR_UNITS = 10_000_000_000;
const MAX_SAFE_POINTS = 10_000_000_000;

export const idrMinorUnitsSchema = z
  .number()
  .int("IDR amounts must be a whole number of Rupiah, never fractional")
  .min(0, "IDR amounts cannot be negative")
  .max(MAX_SAFE_IDR_MINOR_UNITS, "IDR amount exceeds the sane ceiling for this platform")
  .brand<"IdrMinorUnits">();

export type IdrMinorUnits = z.infer<typeof idrMinorUnitsSchema>;

export const pointsSchema = z
  .number()
  .int("Points must be a whole number")
  .min(0, "Points cannot be negative")
  .max(MAX_SAFE_POINTS, "Points amount exceeds the sane ceiling for this platform")
  .brand<"Points">();

export type Points = z.infer<typeof pointsSchema>;

/** Parses a raw number into `IdrMinorUnits`, throwing on anything invalid. */
export function toIdrMinorUnits(value: number): IdrMinorUnits {
  return idrMinorUnitsSchema.parse(value);
}

/** Parses a raw number into `Points`, throwing on anything invalid. */
export function toPoints(value: number): Points {
  return pointsSchema.parse(value);
}

/** Integer-safe addition of two IDR amounts. */
export function addIdr(a: IdrMinorUnits, b: IdrMinorUnits): IdrMinorUnits {
  return toIdrMinorUnits(a + b);
}

/**
 * Integer-safe subtraction of two IDR amounts, clamped at zero. Used for
 * balance-carrying voucher redemption (docs/09 section 8.2) where a partial
 * spend must never leave a negative remaining value.
 */
export function subtractIdrClamped(a: IdrMinorUnits, b: IdrMinorUnits): IdrMinorUnits {
  return toIdrMinorUnits(Math.max(0, a - b));
}

/** Integer-safe addition of two point amounts. */
export function addPoints(a: Points, b: Points): Points {
  return toPoints(a + b);
}

/** Integer-safe subtraction of two point amounts, clamped at zero. */
export function subtractPointsClamped(a: Points, b: Points): Points {
  return toPoints(Math.max(0, a - b));
}

/**
 * Converts a settlement value into a points price at a given backing rate,
 * per the pricing shape in docs/09 section 4.1: `points_price = S / B`.
 *
 * Both sides must share a unit. They are Rupiah today; if YT-0506 settles on
 * sen, the rate becomes sen-per-point and BOTH must move together, or every
 * price is 100x wrong.
 * This is a mock-data convenience, not the real pricing engine — the demand
 * multiplier and its bounds (0.8-1.25) live in the pricing service, not here.
 * Rounds to the nearest whole point; integer arithmetic throughout, no float
 * carried past this function's own division step.
 */
export function pointsPriceFromSettlement(
  settlementValueIdr: IdrMinorUnits,
  backingRateIdrPerPoint: number,
): Points {
  if (backingRateIdrPerPoint <= 0) {
    throw new Error("backingRateIdrPerPoint must be positive");
  }
  return toPoints(Math.round(settlementValueIdr / backingRateIdrPerPoint));
}
