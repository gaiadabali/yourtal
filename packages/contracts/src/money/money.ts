import { z } from "zod";

/**
 * Money and points, the foundation every other schema in this package builds on.
 *
 * Indonesian Rupiah has no minor unit in everyday use (there is no "sen" in
 * circulation), but per docs/15-stack-locked.md the ledger still represents
 * every amount as an integer in its minor unit. For IDR that minor unit is
 * defined here to equal exactly 1 Rupiah — so `idrMinorUnitsSchema` values
 * ARE Rupiah counts, always integers, never floating point. Do not introduce
 * a "cents-of-Rupiah" concept anywhere; it does not exist for this currency.
 *
 * Points are the platform's own currency (docs/09, docs/07 section 2.1) and
 * are likewise always non-negative integers — there is no fractional point.
 *
 * Both types are Zod branded types: the only way to obtain a value typed as
 * `IdrMinorUnits` or `Points` is to run a number through the corresponding
 * schema's `parse`/`safeParse`. There is no cast that manufactures one, by
 * design — that is what makes the brand meaningful.
 */

const MAX_SAFE_IDR_MINOR_UNITS = 10_000_000_000; // IDR 10 billion ceiling, generous for mock data
const MAX_SAFE_POINTS = 10_000_000_000;

export const idrMinorUnitsSchema = z
  .number()
  .int("IDR amounts must be whole Rupiah, never fractional")
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
 * Converts a settlement value in IDR into a points price at a given backing
 * rate, per the pricing shape in docs/09 section 4.1: `points_price = S / B`.
 * This is a mock-data convenience, not the real pricing engine — the demand
 * multiplier and its bounds (0.8-1.25) live in the pricing service, not here.
 * Rounds to the nearest whole point; integer arithmetic throughout, no float
 * carried past this function's own division step.
 */
export function pointsPriceFromSettlement(settlementValueIdr: IdrMinorUnits, backingRateIdrPerPoint: number): Points {
  if (backingRateIdrPerPoint <= 0) {
    throw new Error("backingRateIdrPerPoint must be positive");
  }
  return toPoints(Math.round(settlementValueIdr / backingRateIdrPerPoint));
}

/** Formats an IDR amount for display, e.g. `Rp45.000`. */
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
