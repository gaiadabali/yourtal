/**
 * 13.22.b: a bid is typed in major units ("12.50", "25000") and sent in
 * integer minor units. String arithmetic only, so no float ever touches money.
 * AUD has two decimals; IDR has none (a "." or "," there is a thousands mark).
 */
export function parseBidToMinor(input: string, currency: "AUD" | "IDR"): number | null {
  const raw = input.trim().replace(/\s/g, "");
  if (currency === "IDR") {
    const digits = raw.replace(/[.,]/g, "");
    return /^\d{1,12}$/.test(digits) ? Number(digits) : null;
  }
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(raw.replace(/,/g, ""));
  if (!match) return null;
  const cents = (match[2] ?? "").padEnd(2, "0");
  return Number(match[1]) * 100 + Number(cents);
}

/** The inverse, for prefilling the field with the minimum next bid. */
export function minorToBidInput(minor: number, currency: "AUD" | "IDR"): string {
  if (currency === "IDR") return String(minor);
  return `${String(Math.floor(minor / 100))}.${String(minor % 100).padStart(2, "0")}`;
}
