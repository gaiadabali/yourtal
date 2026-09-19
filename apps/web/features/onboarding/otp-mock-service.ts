import type { RateLimitConfig } from "./otp-rate-limit";

/**
 * Phase U builds against typed mock fixtures, not a running backend
 * (docs/tasks/phase-u-ui.md preamble) — there is no real SMS provider to
 * call, and this ticket is explicitly forbidden from touching `apps/api`.
 * `DEMO_OTP_CODE` is the one code the mock ever accepts, and
 * `phone-verification-flow.tsx` shows it on screen labelled as a prototype
 * hint (`copy.demoCodeHint`), never hidden — pretending this is a real
 * delivery pipeline would itself be a form of the overclaiming
 * docs/23-critique.md section 1.0 warns against.
 */
export const DEMO_OTP_CODE = "123456";

export function isOtpCodeCorrect(inputCode: string): boolean {
  return inputCode.trim() === DEMO_OTP_CODE;
}

/** At most 3 verification attempts per phone number in a 15-minute window before the flow rate-limits. */
export const VERIFY_ATTEMPT_LIMIT: RateLimitConfig = { maxAttempts: 3, windowMs: 15 * 60 * 1000 };

/** At most 3 code resends per phone number in a 30-minute window, independent of the verify-attempt limit. */
export const RESEND_LIMIT: RateLimitConfig = { maxAttempts: 3, windowMs: 30 * 60 * 1000 };

/** A short cooldown between individual resends, even below the rolling-window cap — stops a double-tap immediately re-sending. */
export const RESEND_COOLDOWN_MS = 30 * 1000;

/** Simulated network latency for the mock "send" and "verify" calls, so the loading states in the flow are visible rather than instantaneous. */
export const MOCK_NETWORK_DELAY_MS = 500;
