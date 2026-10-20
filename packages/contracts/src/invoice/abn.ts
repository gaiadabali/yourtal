/**
 * The ATO's ABN checksum: subtract 1 from the first digit, weight the eleven
 * digits, and the sum must divide by 89. Dependency-free, so the API, the
 * worker and the web can all use it. It proves the number is well formed, not
 * that the ABN is registered (that is the ABN Lookup check, not built).
 */
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

export function isValidAbn(abn: string): boolean {
  if (!/^\d{11}$/.test(abn)) return false;
  const digits = abn.split("").map(Number); // digits only, checked above
  digits[0] = (digits[0] ?? 0) - 1;
  const sum = digits.reduce((total, digit, i) => total + digit * (ABN_WEIGHTS[i] ?? 0), 0);
  return sum % 89 === 0;
}
