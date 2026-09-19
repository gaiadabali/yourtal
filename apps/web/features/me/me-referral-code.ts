import * as z from "zod/mini";

/**
 * A per-device demo referral code (YT-0433: "referrals"). There is no
 * referral contract anywhere in `packages/contracts` and no backend to
 * issue or track a real code against a real user — the same gap
 * `features/console/reports`'s `ReportsUnavailablePanel` names honestly
 * rather than fabricating a chart for. This does the equivalent for
 * referrals: it generates and persists a code that is real, final-shape UI
 * (copyable, shareable), but `me-referrals-section.tsx`'s copy is explicit
 * that referral point rewards are not switched on — sharing this code does
 * not grant anything to either side yet.
 *
 * Excludes visually ambiguous characters (`0`/`O`, `1`/`I`) since this is
 * meant to be read aloud or typed by someone else, matching the reasoning
 * `features/onboarding/otp-mock-service.ts` applies to its own demo codes.
 */
const STORAGE_KEY = "yourtal:me-referral-code";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

const codeSchema = z.string().check(z.minLength(CODE_LENGTH));

function generateCode(): string {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  }
  return `YT-${code}`;
}

/** Reads this device's referral code, generating and persisting one on first call. Never throws. */
export function readOrCreateReferralCode(): string {
  try {
    if (typeof window === "undefined") {
      return generateCode();
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const result = codeSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    const created = generateCode();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(created));
    return created;
  } catch {
    return generateCode();
  }
}

/** Used by the account-deletion path: clears this device's referral code. */
export function clearReferralCode(): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode, quota exceeded, or storage disabled.
  }
}
