import { z } from "zod";

/**
 * Money and points, the foundation every other schema in this package builds on.
 *
 * **The IDR minor unit is one sen — one hundredth of a Rupiah.** An
 * `idrMinorUnitsSchema` value is a count of sen, so Rp 45.000 is stored as
 * `4_500_000`.
 *
 * Settled by the founder on 2026-09-20 (YT-0506), after this file had spent
 * the project so far implementing Rupiah while `docs/12`, `docs/18` and
 * YT-0041 all specified sen. The reasoning: sen is uncommon in daily use but
 * **banking uses it**, and amounts appear as `Rp 1.000,26`. That matches ISO
 * 4217 and Stripe's treatment.
 *
 * **It settles the currency, not the processor.** What Xendit accepts is
 * still unconfirmed, and Adyen flags IDR as diverging from ISO precisely
 * because processors genuinely differ. That conversion belongs in each PSP
 * adapter, not in a constant here — see `minor-unit.ts`, which holds the
 * exponent and its evidence, and YT-0537, which makes the unit a declared
 * property of the payment driver so a mismatch fails a parity test instead
 * of settling a merchant 100x wrong.
 *
 * **Prefer `Money` from `money-value.ts` for anything new.** This type names
 * a currency it does not always hold: the AU fixtures store AUD cents in
 * `IdrMinorUnits`-typed fields, which is the wart YT-0513 exists to retire.
 * `Money` carries `{ amountMinor, currency }` and cannot be mistaken that
 * way. `fromLegacyAmount(value, currency)` is the bridge, and it demands the
 * currency precisely so this migration could not relabel AUD cents as sen.
 *
 * Points are the platform's own currency (docs/09, docs/07 section 2.1) and
 * are likewise always non-negative integers — there is no fractional point.
 *
 * FORMATTING LIVES IN `money-format.ts`, not here. That module is
 * dependency-free so client components can format without pulling in Zod,
 * and it takes its scale from `minor-unit.ts` rather than a literal — which
 * is why moving IDR to sen changed no code in the formatter at all.
 *
 * Both types are Zod branded types: the only way to obtain a value typed as
 * `IdrMinorUnits` or `Points` is to run a number through the corresponding
 * schema's `parse`/`safeParse`. There is no cast that manufactures one, by
 * design — that is what makes the brand meaningful.
 */

// Rp 10 billion, expressed in sen. Raised by exactly 100x when YT-0506
// settled on sen: leaving the old ceiling would have rejected every amount
// over Rp 100 million, which is a plausible merchant settlement batch.
// Far beyond int32, which is why src/openapi/build-document.ts widens money
// fields to int64 for Go.
const MAX_SAFE_IDR_MINOR_UNITS = 1_000_000_000_000;
const MAX_SAFE_POINTS = 10_000_000_000;

export const idrMinorUnitsSchema = z
  .number()
  .int("IDR amounts must be a whole number of sen, never fractional")
  .min(0, "IDR amounts cannot be negative")
  .max(MAX_SAFE_IDR_MINOR_UNITS, "IDR amount exceeds the sane ceiling for this platform")
  .brand<"IdrMinorUnits">();

export type IdrMinorUnits = z.infer<typeof idrMinorUnitsSchema>;

/**
 * A whole number of some currency's minor unit, WITHOUT saying which
 * currency (YT-0513).
 *
 * `IdrMinorUnits` above answers "how much" and "in what" at once, which is
 * why AU fixtures could store AUD cents in a field typed `IdrMinorUnits`
 * and render correctly only because every call site remembered to pass
 * `"AUD"` -- `region-mock-au-listing.ts`'s own header calls that the known
 * IDR-field wart.
 *
 * This brand answers only "how much". The currency is a SIBLING field on
 * the same record -- `listingSchema.currency`, one per listing -- so a
 * record cannot carry an amount whose currency is unstated, and cannot
 * carry two amounts in different currencies either.
 *
 * Deliberately NOT a nested `Money` object, though `moneySchema` exists and
 * is the right shape for values in flight. `schema-drift.test.ts` maps each
 * contract field to a snake_case column and demands correspondence both
 * ways, so a nested object needs a written exemption plus columns that
 * correspond to nothing. Callers compose `money(record.fooMinor,
 * record.currency)` at the point of use; the ledger tables already work
 * this way, and matching a table that works beats inventing a second
 * convention.
 *
 * The ceiling is the IDR one, because sen is the smallest minor unit this
 * platform stores and therefore the largest count for a given real value.
 */
export const minorUnitsSchema = z
  .number()
  .int("A money amount must be a whole number of minor units, never fractional")
  .min(0, "A money amount cannot be negative")
  .max(MAX_SAFE_IDR_MINOR_UNITS, "Amount exceeds the sane ceiling for this platform")
  .brand<"MinorUnits">();

export type MinorUnits = z.infer<typeof minorUnitsSchema>;

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

/** Parses a raw number into `MinorUnits`, throwing on anything invalid (YT-0513). */
export function toMinorUnits(value: number): MinorUnits {
  return minorUnitsSchema.parse(value);
}

/** Parses a raw number into `Points`, throwing on anything invalid. */
export function toPoints(value: number): Points {
  return pointsSchema.parse(value);
}

/** Integer-safe addition of two amounts in the SAME currency (YT-0513: the caller states which). */
export function addIdr(a: MinorUnits, b: MinorUnits): MinorUnits {
  return toMinorUnits(a + b);
}

/**
 * Integer-safe subtraction of two IDR amounts, clamped at zero. Used for
 * balance-carrying voucher redemption (docs/09 section 8.2) where a partial
 * spend must never leave a negative remaining value.
 */
export function subtractIdrClamped(a: MinorUnits, b: MinorUnits): MinorUnits {
  return toMinorUnits(Math.max(0, a - b));
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
 * **Both sides must share a unit**, and YT-0506 proved how sharp that is:
 * the settlement value moved from Rupiah to sen, so the rate had to move
 * from Rupiah-per-point to sen-per-point in the same pass. Moving one and
 * not the other leaves every price 100x wrong with no test failing, because
 * the two sides are only ever compared to each other. The mock rate now
 * lives in one place (`mock-backing-rate.ts`) rather than being copied into
 * four files, for exactly that reason.
 * This is a mock-data convenience, not the real pricing engine — the demand
 * multiplier and its bounds (0.8-1.25) live in the pricing service, not here.
 * Rounds to the nearest whole point; integer arithmetic throughout, no float
 * carried past this function's own division step.
 */
export function pointsPriceFromSettlement(
  settlementValueMinor: MinorUnits,
  backingRateIdrPerPoint: number,
): Points {
  if (backingRateIdrPerPoint <= 0) {
    throw new Error("backingRateIdrPerPoint must be positive");
  }
  return toPoints(Math.round(settlementValueMinor / backingRateIdrPerPoint));
}

/** One Rupiah is one hundred sen (YT-0506, settled 2026-09-20). */
export const SEN_PER_RUPIAH = 100;

/**
 * A whole-Rupiah amount, stored as sen.
 *
 * `rupiah(45_000)` is Rp 45.000 and evaluates to `4_500_000`.
 *
 * ## This is the migration seam, not a convenience
 *
 * When YT-0506 settled on sen, roughly ninety IDR literals across twenty-odd
 * files had to move by 100x — and the fixtures for the AU region store **AUD
 * cents** in the same `IdrMinorUnits`-typed fields (the wart named in
 * `region-mock-au-listing.ts`). A blanket multiplication would have turned
 * $12.50 into $1,250: silent, uniform, and wrong by exactly the factor this
 * ticket exists to prevent.
 *
 * Excluding the AU files by hand would have worked once. It would not have
 * been a property of the code — the next person doing a bulk edit would have
 * had to know, from nowhere, which literals were which.
 *
 * So the currency and the unit are stated at the call site instead. A
 * literal written `rupiah(45_000)` cannot be confused with one written
 * `audCents(1_250)`, a bulk edit cannot reach the wrong set because they are
 * different functions, and the 100x conversion exists in exactly one place
 * rather than ninety.
 */
export function rupiah(wholeRupiah: number): MinorUnits {
  return toMinorUnits(Math.round(wholeRupiah * SEN_PER_RUPIAH));
}
