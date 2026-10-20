/**
 * F118: AU prices are ex-GST and GST is added on top; Indonesia adds none
 * (rate 0). One function so the API's purchases and the worker's boost charges
 * round the same way: subtotal x rate, half up to a whole minor unit.
 */
export const BASIS_POINTS = 10_000;

export function taxMinorOf(subtotalMinor: number, rateBps: number): number {
  if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor < 0) {
    throw new RangeError(
      `A subtotal must be a whole, non-negative minor amount: ${String(subtotalMinor)}`,
    );
  }
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > BASIS_POINTS) {
    throw new RangeError(`A tax rate must be 0 to 10000 basis points: ${String(rateBps)}`);
  }
  // BigInt: subtotal x rate can pass 2^53 for large IDR amounts.
  const scaled = BigInt(subtotalMinor) * BigInt(rateBps);
  return Number((scaled * 2n + BigInt(BASIS_POINTS)) / (2n * BigInt(BASIS_POINTS)));
}

/** The GST split of a subtotal. `totalMinor` is what the processor is asked to take. */
export function withTax(
  subtotalMinor: number,
  rateBps: number,
): { readonly subtotalMinor: number; readonly taxMinor: number; readonly totalMinor: number } {
  const taxMinor = taxMinorOf(subtotalMinor, rateBps);
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}
