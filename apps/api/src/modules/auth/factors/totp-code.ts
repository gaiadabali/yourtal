import { Secret, TOTP } from "otpauth";

/**
 * Authenticator-app codes: RFC 6238 with the parameters every common app
 * reads from a QR code (SHA-1, 6 digits, 30 seconds). One step either side
 * is accepted, so a phone clock up to 30 seconds off still works.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DRIFT_STEPS = 1;
const DIGITS = 6;
const ISSUER = "YourTal";

/** A fresh 160-bit seed, base32 (the form an `otpauth://` URI carries). */
export function generateTotpSeed(): string {
  return new Secret({ size: 20 }).base32;
}

function totpFor(seed: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(seed),
  });
}

/** The URI a QR code shows. `label` is what the app lists the entry as. */
export function totpUri(seed: string, label: string): string {
  return totpFor(seed, label).toString();
}

/** The code for a given moment. Tests use it; the server never sends one. */
export function totpCodeAt(seed: string, at: Date): string {
  return totpFor(seed, "code").generate({ timestamp: at.getTime() });
}

/**
 * Checks a code at `now`. On success returns the time step it matched, which
 * the caller records so the same code cannot be used twice.
 */
export function matchTotpCode(seed: string, code: string, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const totp = totpFor(seed, "code");
  const delta = totp.validate({ token: code, timestamp: now.getTime(), window: TOTP_DRIFT_STEPS });
  if (delta === null) return null;
  return totp.counter({ timestamp: now.getTime() }) + delta;
}
