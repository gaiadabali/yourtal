import { enAuOnboardingCopy } from "./onboarding-copy-en-au";
import { idIdOnboardingCopy } from "./onboarding-copy-id-id";

/**
 * Every user-facing string in the onboarding flow, in both languages the
 * product actually ships (docs/tasks/phase-u-ui.md YT-0430: "per-purpose
 * consent screens, specific and unambiguous, in Bahasa and English").
 *
 * This is a plain object literal — no Zod, no dependency at all — so it is
 * safe to import from a "use client" leaf as well as a Server Component,
 * unlike `@yourtal/contracts/region`'s `REGION_CONFIG` (see
 * `onboarding-region-derived.ts` for why that one needs a stopgap instead
 * of being imported directly client-side).
 *
 * Deliberately no template functions on this type (e.g. no
 * `codeSentPrefix: (phone: string) => string`): functions cannot cross the
 * Server->Client props boundary (docs/13b-typescript-standards.md section 8,
 * "Props: serializable ... not class instances or functions"), and this
 * object is also passed as data in tests. Every dynamic value (a phone
 * number, a retry time, a count) is composed by the component itself by
 * concatenating a copy fragment with the value — see `phone-verification-flow.tsx`
 * and `interest-picker.tsx`.
 */
export interface OnboardingPurposeCopy {
  readonly title: string;
  readonly body: string;
}

export interface OnboardingCopy {
  readonly common: {
    readonly back: string;
    readonly stepPrefix: string;
    readonly stepJoiner: string;
  };
  readonly consent: {
    readonly heading: string;
    readonly intro: string;
    readonly essential: OnboardingPurposeCopy;
    readonly personalize: OnboardingPurposeCopy;
    readonly marketing: OnboardingPurposeCopy;
    readonly requiredHint: string;
    readonly continueLabel: string;
  };
  readonly verify: {
    readonly phoneHeading: string;
    readonly phoneIntro: string;
    readonly phoneLabel: string;
    readonly phoneHelp: string;
    readonly sendCode: string;
    readonly sending: string;
    readonly codeHeading: string;
    readonly codeSentPrefix: string;
    readonly codeLabel: string;
    readonly verifyCta: string;
    readonly verifying: string;
    readonly wrongCode: string;
    readonly resend: string;
    readonly resendCooldownPrefix: string;
    readonly resendCooldownSuffix: string;
    readonly wrongNumber: string;
    readonly rateLimitedHeading: string;
    readonly rateLimitedBody: string;
    readonly rateLimitedRetryPrefix: string;
    readonly verified: string;
    readonly demoCodeHint: string;
    readonly otpDisclaimer: string;
  };
  readonly interests: {
    readonly heading: string;
    readonly intro: string;
    readonly continueLabel: string;
    readonly skipLabel: string;
    readonly selectedSuffix: string;
  };
  readonly done: {
    readonly heading: string;
    readonly bodyIntro: string;
    readonly currencyPrefix: string;
    readonly cta: string;
    readonly exampleRewardLabel: string;
  };
}

/**
 * The two locales this ticket's region contract can select
 * (`@yourtal/contracts/region`'s `REGION_CONFIG[region].locale`). Declared
 * here as a plain literal union, not imported from the contract package, so
 * this module has zero runtime dependency on it — see
 * `onboarding-region-derived.ts`.
 */
export type OnboardingLocale = "en-AU" | "id-ID";

/**
 * Picks the copy bundle for a locale. `switch` is exhaustive with a `never`
 * default (docs/13b-typescript-standards.md section 4): adding a third
 * locale without a copy bundle for it is a compile error here, not a silent
 * fallback to English.
 */
export function getOnboardingCopy(locale: OnboardingLocale): OnboardingCopy {
  switch (locale) {
    case "en-AU":
      return enAuOnboardingCopy;
    case "id-ID":
      return idIdOnboardingCopy;
    default: {
      const exhaustive: never = locale;
      return exhaustive;
    }
  }
}
