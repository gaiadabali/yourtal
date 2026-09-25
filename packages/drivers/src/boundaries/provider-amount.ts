import { type Result, err, ok } from "neverthrow";
import type { Currency } from "@yourtal/contracts/money/currency";
import { minorUnitExponent } from "@yourtal/contracts/money/minor-unit";

/**
 * Converting a stored amount into the units a processor speaks. YT-0537.
 *
 * ## The whole point of the ticket
 *
 * FOUNDER DECISION T-1 settled what this platform **stores** — IDR in whole
 * Rupiah, exponent 0 — and that happens to now agree with Xendit, but it
 * never settled what a processor **accepts** in general. Adyen publicly
 * flags IDR as diverging from ISO, so a different processor in our own stack
 * may genuinely want a different integer for the same money.
 *
 * A driver that assumed the stored unit would be right by luck. This module
 * makes the processor's unit a **declared property of the driver**, and
 * converts between the two — so the open question becomes a per-adapter
 * conversion instead of a global constant, which is the shape the money
 * question has pointed at since the beginning.
 *
 * ## Why the parity property is value preservation, not exponent equality
 *
 * The obvious test is "the driver's exponent equals `MINOR_UNIT`'s". That
 * would be wrong: a processor legitimately wanting a different unit is not a
 * bug, it is the case this design exists for. Asserting equality would
 * forbid the very thing we are building.
 *
 * What must hold is that **the same real-world amount comes out the other
 * side**. A stored amount of 45_000 at exponent 0 and 4_500_000 at exponent 2
 * both denote the same 45,000 whole units — whichever exponent a specific
 * processor happens to want. That is the property `payments-parity.test.ts`
 * checks, and it is the one that catches a 100x error whichever direction
 * the mistake runs.
 *
 * ## Integer-only, and a refusal rather than a rounding
 *
 * Converting down a scale can lose money. `4_500_050` at exponent 2 has no
 * exact representation at exponent 0 — there is no such thing as half a
 * whole unit to send. Rounding would silently discard the remainder, which
 * is the kind of loss that is invisible per-item and material per-million —
 * so this returns an error instead. A caller has to decide what to do about
 * a remainder; the adapter must not decide for them.
 *
 * No floating point anywhere. `4_500_000 / 100` happens to be exact, but
 * `0.1 + 0.2` is the reason nobody should be asked to check which values are.
 */

export interface AmountConversionError {
  readonly kind: "inexact_conversion" | "negative_amount" | "not_an_integer";
  readonly detail: string;
  readonly storedAmountMinor: number;
  readonly currency: Currency;
}

/** Ten to the power of `exponent`, as an integer. */
function scale(exponent: number): number {
  return 10 ** exponent;
}

/**
 * The integer a processor should be sent for a stored amount.
 *
 * `providerExponent` is what the DRIVER declares it speaks. The stored
 * exponent comes from `MINOR_UNIT`, which is what this platform declares it
 * holds. Neither derives from the other — that separation is the only reason
 * comparing them means anything.
 */
export function toProviderAmount(
  storedAmountMinor: number,
  currency: Currency,
  providerExponent: number,
): Result<number, AmountConversionError> {
  if (!Number.isInteger(storedAmountMinor)) {
    return err({
      kind: "not_an_integer",
      detail: "A stored money amount is always a whole number of minor units.",
      storedAmountMinor,
      currency,
    });
  }
  if (storedAmountMinor < 0) {
    return err({
      kind: "negative_amount",
      detail: "Amounts sent to a processor are never negative; a refund is its own operation.",
      storedAmountMinor,
      currency,
    });
  }

  const storedExponent = minorUnitExponent(currency);

  if (providerExponent === storedExponent) {
    return ok(storedAmountMinor);
  }

  if (providerExponent > storedExponent) {
    // The processor wants a finer unit than we store. Always exact.
    return ok(storedAmountMinor * scale(providerExponent - storedExponent));
  }

  // The processor wants a coarser unit. Exact only if nothing is left over.
  const divisor = scale(storedExponent - providerExponent);
  if (storedAmountMinor % divisor !== 0) {
    return err({
      kind: "inexact_conversion",
      detail:
        `${String(storedAmountMinor)} stored minor units of ${currency} does not divide into a ` +
        `processor unit of exponent ${String(providerExponent)}. Rounding here would discard ` +
        `${String(storedAmountMinor % divisor)} minor units per transaction, silently.`,
      storedAmountMinor,
      currency,
    });
  }
  return ok(storedAmountMinor / divisor);
}

/**
 * The stored amount a processor's integer represents — the inverse.
 *
 * Needed for webhooks: a callback quotes the amount in the processor's units
 * and a handler has to compare it against what we recorded. Doing that
 * comparison without converting is how a settled-amount check passes for the
 * wrong money.
 */
export function fromProviderAmount(
  providerAmount: number,
  currency: Currency,
  providerExponent: number,
): Result<number, AmountConversionError> {
  if (!Number.isInteger(providerAmount)) {
    return err({
      kind: "not_an_integer",
      detail: "A processor amount is always an integer in its own minor unit.",
      storedAmountMinor: providerAmount,
      currency,
    });
  }

  const storedExponent = minorUnitExponent(currency);

  if (providerExponent === storedExponent) return ok(providerAmount);
  if (storedExponent > providerExponent) {
    return ok(providerAmount * scale(storedExponent - providerExponent));
  }

  const divisor = scale(providerExponent - storedExponent);
  if (providerAmount % divisor !== 0) {
    return err({
      kind: "inexact_conversion",
      detail: `${String(providerAmount)} provider units of ${currency} does not divide into our stored unit.`,
      storedAmountMinor: providerAmount,
      currency,
    });
  }
  return ok(providerAmount / divisor);
}
