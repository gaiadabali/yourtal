import { z } from "zod";
import { CURRENCY_CODES, type Currency } from "./currency";
import { toIdrMinorUnits, type IdrMinorUnits } from "./money";

/**
 * `Money` — an integer amount that carries its own currency. YT-0513.
 *
 * `docs/12` section 3 specifies Fowler's Money pattern, `(int64 amount_minor,
 * currency)`. The repo had the first half and not the second: every amount is
 * an integer in some minor unit, and nothing anywhere says which currency
 * that unit belongs to.
 *
 * ## Why a phantom type would not have been enough
 *
 * The obvious cheap fix is a compile-time tag — `Money<"AUD">` versus
 * `Money<"IDR">`, erased at build. It would have caught nothing that matters
 * here, because **no core schema carries a currency or a region**:
 * `listingSchema`, `voucherSchema` and `campaignSchema` are all currency-free,
 * and `REGION_CONFIG` maps region to currency without anything in the value
 * path consuming it. A phantom tag disappears at exactly the JSON and SQL
 * boundaries where the currency is already missing, so it would decorate the
 * one layer that was never the problem.
 *
 * The concrete symptom is in `region-mock-au-listing.ts`, whose own header
 * calls it "the known IDR-field wart": AU fixtures store **AUD cents** in
 * `faceValueIdr`, a field typed `IdrMinorUnits`, and they render correctly
 * only because every call site remembers to pass `"AUD"` to `formatMoney`.
 * A convention kept in human memory is the thing this type replaces, so the
 * currency has to be present at runtime.
 *
 * ## What is deliberately absent
 *
 * There is **no exponent and no formatting here.** How many decimals a
 * currency's integer represents lives in `minor-unit.ts`, because an amount
 * can be stored, transported, added, subtracted and compared without anyone
 * knowing it — which is precisely why the Go ledger could ship while YT-0506
 * is still open. Welding the exponent to the amount would spread one open
 * question across every operation instead of the two that genuinely need it.
 *
 * ## Scope
 *
 * This module is additive. `IdrMinorUnits` and every existing schema are
 * untouched: migrating the wire fields changes `apps/web`, the OpenAPI
 * document and the Go types together, and is coordinated separately rather
 * than smuggled in beside the type that makes it possible.
 */

// Shared with `money.ts`: IDR 10 billion, past int32, which is why
// `src/openapi/build-document.ts` widens money fields to int64 for Go.
const MAX_SAFE_AMOUNT_MINOR = 10_000_000_000;

export const currencySchema = z.enum(CURRENCY_CODES);

export const moneySchema = z
  .object({
    /**
     * Whole units of `currency`'s minor unit. Never a float: a tenth of a
     * cent has no representation in any ledger this platform talks to, and
     * binary floating point cannot hold one exactly anyway.
     */
    amountMinor: z
      .number()
      .int("A money amount must be a whole number of minor units, never fractional")
      .min(0, "A money amount cannot be negative")
      .max(MAX_SAFE_AMOUNT_MINOR, "Money amount exceeds the sane ceiling for this platform"),
    currency: currencySchema,
  })
  .brand<"Money">();

export type Money = z.infer<typeof moneySchema>;

/** Thrown when two amounts in different currencies meet. */
export class CurrencyMismatchError extends Error {
  constructor(left: Currency, right: Currency, operation: string) {
    super(
      `Cannot ${operation} ${left} and ${right}: there is no exchange rate in this codebase, ` +
        `and inventing one at an arithmetic call site is how a rate becomes untraceable.`,
    );
    this.name = "CurrencyMismatchError";
  }
}

/** Builds a `Money`, validating the amount. The only way to obtain one. */
export function money(amountMinor: number, currency: Currency): Money {
  return moneySchema.parse({ amountMinor, currency });
}

export function zeroMoney(currency: Currency): Money {
  return money(0, currency);
}

/**
 * Re-tags a legacy `IdrMinorUnits` value as `Money`, **requiring the caller
 * to name the currency**.
 *
 * The currency argument is not a convenience, it is the entire purpose. A
 * one-argument `fromIdrMinorUnits` would tag everything `IDR` and would
 * therefore relabel every AU fixture's cents as Rupiah — silently, and with
 * the type system's blessing, which is worse than the wart it replaces.
 * Making it an argument forces the migration to answer, once per call site,
 * the question the field name has been guessing at.
 */
export function fromLegacyAmount(value: IdrMinorUnits, currency: Currency): Money {
  return money(value, currency);
}

function requireSameCurrency(left: Money, right: Money, operation: string): Currency {
  if (left.currency !== right.currency) {
    throw new CurrencyMismatchError(left.currency, right.currency, operation);
  }
  return left.currency;
}

export function addMoney(left: Money, right: Money): Money {
  const currency = requireSameCurrency(left, right, "add");
  return money(left.amountMinor + right.amountMinor, currency);
}

/**
 * Subtraction clamped at zero, for balance-carrying voucher redemption
 * (docs/09 section 8.2) where a partial spend must never leave a negative
 * remainder. Mirrors `subtractIdrClamped`, currency-checked.
 */
export function subtractMoneyClamped(left: Money, right: Money): Money {
  const currency = requireSameCurrency(left, right, "subtract");
  return money(Math.max(0, left.amountMinor - right.amountMinor), currency);
}

/** Negative, zero or positive, in the manner of a comparator. */
export function compareMoney(left: Money, right: Money): number {
  requireSameCurrency(left, right, "compare");
  return left.amountMinor - right.amountMinor;
}

/**
 * An AUD amount in cents, in the legacy `IdrMinorUnits`-typed fields the
 * schemas still use.
 *
 * Arithmetically the identity function. **The name is the entire point.**
 * `listingSchema.faceValueIdr` holds AUD cents for every AU fixture, and
 * until the wire migration retires that field name, the only thing standing
 * between those literals and a 100x error during an IDR unit change is
 * whether the person doing it happened to know. Writing `audCents(1_250)`
 * says it in the source, where a bulk edit can see it.
 *
 * It routes through `money()` rather than `toIdrMinorUnits` directly, so the
 * value really is validated as money in a named currency rather than merely
 * annotated as one.
 */
export function audCents(cents: number): IdrMinorUnits {
  return toIdrMinorUnits(money(cents, "AUD").amountMinor);
}
