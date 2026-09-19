import * as z from "zod/mini";

/**
 * Local, demo-only "is a passkey enrolled on this device" flag. There is no
 * WebAuthn call anywhere in this module — no `navigator.credentials`, no
 * server to register a credential against — because Phase U has no auth
 * backend for this ticket to wire up to. This stores a label, nothing more,
 * and `me-security-section.tsx`'s copy says so plainly rather than
 * pretending a real credential exists (docs/23-critique.md §1.0: a passkey
 * was measured at $0 to fake at scale, so claiming one here would overstate
 * exactly the control that document warns is weakest).
 */
const STORAGE_KEY = "yourtal:me-passkey-demo";

const enrolledSchema = z.boolean();

export function readPasskeyEnrolled(): boolean {
  try {
    if (typeof window === "undefined") {
      return false;
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const parsed: unknown = JSON.parse(raw);
    const result = enrolledSchema.safeParse(parsed);
    return result.success ? result.data : false;
  } catch {
    return false;
  }
}

export function writePasskeyEnrolled(enrolled: boolean): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(enrolled));
  } catch {
    // Private mode, quota exceeded, or storage disabled.
  }
}

/** Used by the account-deletion path: clears this device's demo passkey label. */
export function clearPasskeyEnrolled(): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as writePasskeyEnrolled.
  }
}
