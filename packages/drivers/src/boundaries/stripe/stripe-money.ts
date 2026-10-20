import { type Result, err, ok } from "neverthrow";
import type { Currency } from "@yourtal/contracts/money/currency";
import type { BoundaryFailure } from "../../fault-engine";
import { fromProviderAmount, toProviderAmount } from "../provider-amount";

/**
 * Stripe speaks AUD in cents. IDR is deliberately undeclared: Indonesia stays on the simulated driver (F104), so
 * an IDR call reaching a Stripe driver is refused by the undeclared-unit rule instead of being guessed.
 */
export const STRIPE_EXPONENTS: Partial<Record<Currency, number>> = { AUD: 2 };

/** Stripe's documented minimum charge, in OUR minor units (A$0.50). */
export const STRIPE_MINIMUM_CHARGE_MINOR: Partial<Record<Currency, number>> = { AUD: 50 };

function declined(boundary: string, detail: string): BoundaryFailure {
  return { kind: "declined", boundary, detail, mayHaveSucceeded: false };
}

export function toStripeAmount(
  boundary: string,
  amountMinor: number,
  currency: Currency,
): Result<number, BoundaryFailure> {
  const exponent = STRIPE_EXPONENTS[currency];
  if (exponent === undefined) {
    return err(
      declined(
        boundary,
        `No declared minor-unit exponent for ${currency}: the Stripe driver does not speak it ` +
          "(Indonesia runs on the simulated driver, F104).",
      ),
    );
  }
  const converted = toProviderAmount(amountMinor, currency, exponent);
  return converted.isErr() ? err(declined(boundary, converted.error.detail)) : ok(converted.value);
}

/** A charge Stripe would refuse with amount_too_small, refused here without calling it. */
export function checkMinimumCharge(
  boundary: string,
  amountMinor: number,
  currency: Currency,
): Result<void, BoundaryFailure> {
  const minimum = STRIPE_MINIMUM_CHARGE_MINOR[currency];
  if (minimum !== undefined && amountMinor < minimum) {
    return err(
      declined(
        boundary,
        `${String(amountMinor)} minor units of ${currency} is below Stripe's minimum charge of ${String(minimum)}.`,
      ),
    );
  }
  return ok(undefined);
}

/** Stripe's lowercase code back to ours, only for a currency this driver declares. */
export function currencyFromStripe(code: string | undefined): Currency | undefined {
  const upper = code?.toUpperCase();
  return upper === "AUD" && STRIPE_EXPONENTS.AUD !== undefined ? "AUD" : undefined;
}

export function stripeCurrency(currency: Currency): string {
  return currency.toLowerCase();
}

/** A Stripe amount back into OUR minor units, or undefined if it cannot be converted exactly. */
export function fromStripeAmount(amount: number, currency: Currency): number | undefined {
  const exponent = STRIPE_EXPONENTS[currency];
  if (exponent === undefined) return undefined;
  const converted = fromProviderAmount(amount, currency, exponent);
  return converted.isOk() ? converted.value : undefined;
}
