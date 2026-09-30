/** Minor-unit exponent per currency: AUD has cents, IDR has none. */
const EXPONENT: Readonly<Record<"AUD" | "IDR", number>> = { AUD: 2, IDR: 0 };

/**
 * A typed amount ("12.50") to exact integer minor units, without floating
 * point: too many decimals, a sign, or nothing at all is `null`.
 */
export function minorFromInput(text: string, currency: "AUD" | "IDR"): number | null {
  const exponent = EXPONENT[currency];
  const cleaned = text.trim().replace(/[\s,]/g, "");
  const pattern =
    exponent === 0 ? /^(\d+)$/ : new RegExp(`^(\\d+)(?:\\.(\\d{1,${String(exponent)}}))?$`);
  const match = pattern.exec(cleaned);
  if (match === null) return null;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(exponent, "0");
  const minor = Number(`${whole}${fraction}`);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** Integer minor units back to a plain input value ("12.50", "5000"). */
export function inputFromMinor(minor: number, currency: "AUD" | "IDR"): string {
  const exponent = EXPONENT[currency];
  if (exponent === 0) return String(minor);
  const text = String(minor).padStart(exponent + 1, "0");
  return `${text.slice(0, -exponent)}.${text.slice(-exponent)}`;
}
