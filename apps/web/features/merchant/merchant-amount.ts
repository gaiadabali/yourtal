import type { Currency } from "@yourtal/contracts/money/currency";
import type { MerchantLocale } from "./merchant-device";

/** Minor-unit exponent per currency (K6): AUD has cents, IDR has no minor unit. */
const EXPONENT: Record<Currency, number> = { AUD: 2, IDR: 0 };

/** Each device language writes numbers its own way: en-AU "1,000.50", id-ID "1.000,50". */
const SEPARATORS: Record<MerchantLocale, { group: string; decimal: string }> = {
  "en-AU": { group: ",", decimal: "." },
  "id-ID": { group: ".", decimal: "," },
};

/** Beyond this many digits the integer would stop being exact; no voucher is worth that much. */
const MAX_DIGITS = 12;

export type AmountParseFailure = "empty" | "invalid" | "too_precise";

export type AmountParseResult =
  { ok: true; amountMinor: number } | { ok: false; reason: AmountParseFailure };

export function currencyExponent(currency: Currency): number {
  return EXPONENT[currency];
}

/**
 * What a cashier typed, in major units (dollars, rupiah), to exact integer
 * minor units. Pure string arithmetic: the digits are split at the decimal
 * separator and recombined, so no float ever touches the money ("4.50" is
 * never 4.4999999). Grouping separators are accepted only where they would
 * really be (groups of three), so "1,00" is refused rather than guessed.
 */
export function parseAmountInput(
  text: string,
  currency: Currency,
  locale: MerchantLocale,
): AmountParseResult {
  const typed = text.trim().replace(/\s+/gu, "");
  if (typed === "") {
    return { ok: false, reason: "empty" };
  }
  const { group, decimal } = SEPARATORS[locale];
  const exponent = EXPONENT[currency];

  const decimalAt = typed.indexOf(decimal);
  if (decimalAt !== typed.lastIndexOf(decimal)) {
    return { ok: false, reason: "invalid" };
  }
  const whole = decimalAt === -1 ? typed : typed.slice(0, decimalAt);
  const fraction = decimalAt === -1 ? "" : typed.slice(decimalAt + 1);

  const wholeDigits = stripGrouping(whole, group);
  if (wholeDigits === null || !/^\d*$/u.test(fraction)) {
    return { ok: false, reason: "invalid" };
  }
  if (wholeDigits === "" && fraction === "") {
    return { ok: false, reason: "invalid" };
  }
  // Trailing zeros past the currency's precision are harmless ("4.500" is 4.50), a real digit is not.
  const surplus = fraction.slice(exponent);
  if (/[^0]/u.test(surplus)) {
    return { ok: false, reason: "too_precise" };
  }
  const minorDigits = `${wholeDigits === "" ? "0" : wholeDigits}${fraction.slice(0, exponent).padEnd(exponent, "0")}`;
  const significant = minorDigits.replace(/^0+(?=\d)/u, "");
  if (significant.length > MAX_DIGITS) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, amountMinor: Number(significant) };
}

/** "1,000" is fine, "1,00" and ",5" are not; `null` for a misplaced separator. */
function stripGrouping(whole: string, group: string): string | null {
  if (!whole.includes(group)) {
    return /^\d*$/u.test(whole) ? whole : null;
  }
  const parts = whole.split(group);
  const [first, ...rest] = parts;
  if (first === undefined || !/^\d{1,3}$/u.test(first) || !rest.every((p) => /^\d{3}$/u.test(p))) {
    return null;
  }
  return parts.join("");
}

/**
 * Minor units back to what a cashier would type (no symbol, no grouping),
 * so "Back" from the review step shows the amount as it was entered.
 */
export function formatAmountForInput(
  amountMinor: number,
  currency: Currency,
  locale: MerchantLocale,
): string {
  const exponent = EXPONENT[currency];
  if (exponent === 0) {
    return String(amountMinor);
  }
  const digits = String(amountMinor).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${whole}${SEPARATORS[locale].decimal}${fraction}`;
}
