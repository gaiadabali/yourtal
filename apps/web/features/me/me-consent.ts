import * as z from "zod/mini";

/**
 * Per-purpose consent, modelled locally for the Me screen (YT-0433).
 *
 * `packages/consent` is the package that will own the real, durable
 * consent record (docs/03-regulatory-and-risk.md §2.3, docs/24-legal-positions.md
 * ID-7: "consent must be specific and unambiguous ... revocable"). This
 * ticket is explicitly forbidden from importing or editing that package, so
 * — matching `features/onboarding/onboarding-local-store.ts`'s own
 * reasoning — this models the exact shape a real read/write needs and
 * writes it to `localStorage` behind this one seam. Wiring this up to
 * `packages/consent` later should mean replacing this module's two
 * functions, not redesigning any component that calls them.
 *
 * The three purposes are the same three `features/onboarding/consent-form.tsx`
 * collects at sign-up (`essential` / `personalize` / `marketing`), with the
 * same names and the same meaning — a user who agreed to "personalise which
 * campaigns I see" at sign-up must find that exact toggle here, or they
 * cannot reconcile what they agreed to with what they can change.
 */
export type ConsentPurposeId = "personalize" | "marketing";

export interface ConsentPreferences {
  /** Account + phone verification. Always true — see `me-consent-toggle.tsx` for why this purpose has no toggle. */
  readonly essential: true;
  readonly personalize: boolean;
  readonly marketing: boolean;
  readonly updatedAt: string;
}

export const consentPreferencesSchema = z.object({
  essential: z.literal(true),
  personalize: z.boolean(),
  marketing: z.boolean(),
  updatedAt: z.iso.datetime(),
});

/**
 * The shape `saveOnboardingConsentChoice` in `features/onboarding/onboarding-local-store.ts`
 * writes (`{ essential, personalize, marketing, decidedAt }`). Duplicated
 * here — not imported, since `features/onboarding/**` is this ticket's
 * read-only reference, not a dependency — so this module can seed a
 * first-time visit to Me from the exact choice made at sign-up. See
 * `me-consent-store.ts`'s `SEED_STORAGE_KEY` for why the key string itself
 * must still match byte-for-byte.
 */
const onboardingConsentChoiceSchema = z.object({
  essential: z.literal(true),
  personalize: z.boolean(),
  marketing: z.boolean(),
  decidedAt: z.iso.datetime(),
});

export function parseOnboardingConsentChoice(value: unknown): ConsentPreferences | null {
  const result = onboardingConsentChoiceSchema.safeParse(value);
  if (!result.success) {
    return null;
  }
  return {
    essential: true,
    personalize: result.data.personalize,
    marketing: result.data.marketing,
    updatedAt: result.data.decidedAt,
  };
}

/** Both optional purposes default to off — matching the un-ticked default `consent-form.tsx` uses at sign-up, for a visitor with no record at all. */
export function defaultConsentPreferences(nowIso: string): ConsentPreferences {
  return { essential: true, personalize: false, marketing: false, updatedAt: nowIso };
}

export function withPurposeChanged(
  preferences: ConsentPreferences,
  purpose: ConsentPurposeId,
  granted: boolean,
  nowIso: string,
): ConsentPreferences {
  return { ...preferences, [purpose]: granted, updatedAt: nowIso };
}
