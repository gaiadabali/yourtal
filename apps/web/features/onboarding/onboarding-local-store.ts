/**
 * Local (browser-only) persistence for onboarding choices, matching the
 * Phase U mandate ("fixtures live in packages/contracts... the mock layer is
 * a seam, not a throwaway", docs/tasks/phase-u-ui.md preamble) applied to
 * user-entered data instead of catalogue fixtures.
 *
 * Per-purpose consent is a compliance control (docs/03-regulatory-and-risk.md,
 * docs/24-legal-positions.md ID-7), and its real, durable storage belongs to
 * `packages/consent` — a package this ticket is explicitly forbidden from
 * touching, and which YT-0433 ("Me, settings and consent controls") is the
 * ticket that wires up. Writing to `packages/consent` from here would be
 * inventing a second, competing consent record. This module instead writes
 * the exact shape a real submission needs, to `localStorage`, so the UI is
 * fully demoable today and the eventual wiring is "POST this object",
 * not "redesign the form".
 *
 * Every call is wrapped in try/catch: `localStorage` can throw (private
 * browsing, quota, disabled storage), and a storage failure must never block
 * the onboarding flow it is a side effect of.
 */

const CONSENT_STORAGE_KEY = "yourtal:onboarding-consent";
const INTERESTS_STORAGE_KEY = "yourtal:onboarding-interests";

export interface OnboardingConsentChoice {
  /** Always true when this is saved — the essential purpose gates reaching this point (see `consent-form.tsx`). */
  readonly essential: true;
  readonly personalize: boolean;
  readonly marketing: boolean;
  readonly decidedAt: string;
}

export function saveOnboardingConsentChoice(choice: OnboardingConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // See this file's doc comment — a storage nicety, never load-bearing.
  }
}

export function saveOnboardingInterestSelection(interestIds: readonly string[]): void {
  try {
    window.localStorage.setItem(INTERESTS_STORAGE_KEY, JSON.stringify(interestIds));
  } catch {
    // See this file's doc comment.
  }
}
