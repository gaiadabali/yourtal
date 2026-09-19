/**
 * Hashing for the shift PIN — deliberately minimal, and deliberately NOT a
 * template for real credential storage. Read this comment before copying
 * this pattern anywhere else.
 *
 * docs/17-surfaces-and-roles.md section 2.2 is explicit that this PIN is "a
 * short PIN [that] unlocks the session; it does not authenticate a person."
 * It is a shift-level convenience lock against the device being left
 * unlocked on a counter — not a credential standing between an attacker
 * and value, the way a login password or a merchant API key is. That is
 * the ONLY reason a fast, unsalted-in-the-cryptographic-sense (see below)
 * SHA-256 is used here instead of a real password KDF:
 *
 *  - No work factor. SHA-256 is intentionally fast, which is exactly wrong
 *    for a real credential — a 4-6 digit PIN's keyspace is 10,000-1,000,000
 *    values, brute-forceable in well under a second against a fast hash if
 *    an attacker ever gets the hash itself. A real implementation must use
 *    a slow, memory-hard KDF (Argon2id, scrypt) so that even a leaked hash
 *    costs meaningful time per guess.
 *  - No server-side rate limiting beyond the best-effort, in-process
 *    counter in `provisioning-actions.ts` (see that file's comment on why
 *    it is not a real defence).
 *  - This mock has no backend at all (docs/09 section 8's redemption API
 *    does not exist yet), so "hash it server-side" here means "hash it in
 *    a Next.js Server Action," not a real authentication service with its
 *    own audit log, lockout policy and incident response hook
 *    (docs/14-security-engineering.md section 5).
 *
 * What DOES carry real weight here, and is the actual point of this
 * ticket: the hash and salt live ONLY in an httpOnly cookie
 * (`device-session-cookie.ts`), never in `localStorage`, never sent to the
 * client, and the plaintext PIN is never persisted anywhere, ever — it
 * exists only for the duration of one Server Action call. A real
 * implementation must go further and move the check itself off this
 * device entirely (a rate-limited, audited endpoint, per docs/14 section
 * 5's authentication-hardening rules), so that even full compromise of
 * this device's storage reveals nothing usable offline.
 *
 * Web Crypto (`crypto.subtle`), not `node:crypto`: Server Actions can run
 * on either the Node.js or the Edge runtime, and `crypto.subtle` is the
 * one hashing API both support.
 */

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A fresh, random per-device salt — stops two devices that happen to choose the same PIN from sharing a hash. */
export function generatePinSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

/**
 * Best-effort constant-time comparison. Genuine timing-attack resistance
 * needs the comparison to run where an attacker cannot measure wall-clock
 * time precisely (i.e. server-side over a network, which this already is —
 * `provisioning-actions.ts` runs in a Server Action, never in the
 * browser); this loop just avoids the most obvious short-circuit-on-first-
 * mismatch leak within that call.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function verifyPin(pin: string, salt: string, expectedHash: string): Promise<boolean> {
  const candidate = await hashPin(pin, salt);
  return timingSafeEqual(candidate, expectedHash);
}
