/**
 * Australian Business Numbers, for the Spam Act footer of the counter-spam reply (BUILD.md §12.2/§12.3).
 * The ABN is a setting (`SPAMBANK_SENDER_ABN`), never hard-coded: until GOD's real one is set, the reply
 * shows the owner's mock line, and production refuses `live` (spambank-config.ts).
 */

/** The owner's placeholder line, shown while no ABN is set (staging only; production refuses `live`). */
export const MOCK_ABN_LINE = "00 000 000 000 [MOCK]";

const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19] as const;

/** Digits only, or null when the value is not 11 digits once spaces are removed. */
export function abnDigits(raw: string): string | null {
  const digits = raw.replace(/\s+/g, "");
  return /^\d{11}$/.test(digits) ? digits : null;
}

/** The ATO checksum: subtract 1 from the first digit, weight, sum, divisible by 89. */
export function isValidAbn(raw: string): boolean {
  const digits = abnDigits(raw);
  if (digits === null) return false;
  let sum = 0;
  for (let i = 0; i < 11; i += 1) {
    const digit = Number(digits[i]) - (i === 0 ? 1 : 0);
    sum += digit * (WEIGHTS[i] ?? 0);
  }
  return sum % 89 === 0;
}

/** `51824753556` → `51 824 753 556`, the way ABNs are printed. */
export function formatAbn(digits: string): string {
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;
}
