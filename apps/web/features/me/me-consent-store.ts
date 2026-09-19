import {
  consentPreferencesSchema,
  defaultConsentPreferences,
  parseOnboardingConsentChoice,
  type ConsentPreferences,
} from "./me-consent";

/**
 * `localStorage` is a process boundary (docs/13b-typescript-standards.md §3)
 * — another tab, a stale schema version, or a tampered value can all write
 * there — so every read is Zod-parsed and every access wrapped in
 * try/catch, and a storage failure never blocks rendering. Same discipline
 * as `apps/web/features/player/resume-position.ts` and
 * `apps/web/features/wallet/voucher-detail-cache.ts`.
 *
 * `SEED_KEY` is the literal string `features/onboarding/onboarding-local-store.ts`'s
 * `CONSENT_STORAGE_KEY` writes to today. It is duplicated rather than
 * imported (`features/onboarding/**` is this ticket's read-only reference,
 * not a dependency this feature can pull code from), so it must stay
 * byte-for-byte identical for the seed below to ever find anything — flagged
 * in this ticket's report as a drift risk a real `packages/consent`
 * integration removes entirely by giving both screens one source of truth.
 */
const SEED_KEY = "yourtal:onboarding-consent";
const CURRENT_KEY = "yourtal:me-consent";

/**
 * Reads the user's current consent preferences.
 *
 * Resolution order: (1) a preference already recorded here by a prior visit
 * to Me; (2) the choice made at sign-up, adopted as the starting point and
 * immediately persisted under this feature's own key so it becomes the
 * record of truth from here on; (3) the off-by-default preferences a
 * visitor with no record at all gets. Never throws.
 */
export function readConsentPreferences(nowIso: string): ConsentPreferences {
  if (typeof window === "undefined") {
    return defaultConsentPreferences(nowIso);
  }
  // Each source is parsed independently, in its own try/catch: a corrupt
  // CURRENT_KEY entry must not hide a perfectly good SEED_KEY one, and a
  // corrupt SEED_KEY must not throw past the final default.
  const current = tryParseCurrent(safeGetItem(CURRENT_KEY));
  if (current) {
    return current;
  }
  const seeded = tryParseSeed(safeGetItem(SEED_KEY));
  if (seeded) {
    writeConsentPreferences(seeded);
    return seeded;
  }
  return defaultConsentPreferences(nowIso);
}

function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function tryParseCurrent(raw: string | null): ConsentPreferences | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = consentPreferencesSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function tryParseSeed(raw: string | null): ConsentPreferences | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parseOnboardingConsentChoice(parsed);
  } catch {
    return null;
  }
}

/** Best-effort write. A failed write must never break the toggle it is a side effect of — the UI state still updates. */
export function writeConsentPreferences(preferences: ConsentPreferences): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(CURRENT_KEY, JSON.stringify(preferences));
  } catch {
    // Private mode, quota exceeded, or storage disabled — see this file's doc comment.
  }
}

/** Used by the account-deletion path (`me-delete-account-section.tsx`): clears this device's local consent record. */
export function clearConsentPreferences(): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(CURRENT_KEY);
  } catch {
    // Same as writeConsentPreferences.
  }
}
