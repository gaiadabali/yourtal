import * as z from "zod/mini";

/**
 * Reads and writes the same `localStorage` record
 * `features/onboarding/onboarding-local-store.ts`'s
 * `saveOnboardingInterestSelection` writes to (`INTERESTS_STORAGE_KEY`,
 * duplicated here as the literal below — see `me-consent-store.ts`'s
 * `SEED_KEY` comment for why a literal duplicate, not an import, and the
 * same drift risk this flags for a real `packages/consent`-adjacent
 * profile service to remove). Using the identical key means an interest
 * picked at sign-up and a change made here are genuinely the same record,
 * not two competing ones — the brief's "changes must be reversible"
 * requirement for interests.
 *
 * `zod/mini`, not `zod` (docs/13b-typescript-standards.md §3, §8): this
 * module is imported from a "use client" leaf.
 */
const STORAGE_KEY = "yourtal:onboarding-interests";

const interestIdsSchema = z.array(z.string().check(z.minLength(1)));

/** Reads the saved interest ids, or `[]` if there is none or it fails to validate. Never throws. */
export function readInterestIds(): readonly string[] {
  try {
    if (typeof window === "undefined") {
      return [];
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    const result = interestIdsSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

/** Best-effort write. A failed write must never break the toggle it is a side effect of. */
export function writeInterestIds(interestIds: readonly string[]): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(interestIds));
  } catch {
    // Private mode, quota exceeded, or storage disabled.
  }
}

/** Used by the account-deletion path: clears this device's saved interests. */
export function clearInterestIds(): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as writeInterestIds.
  }
}
