import { OnboardingConsentStep } from "@/features/onboarding/onboarding-consent-step";
import { OnboardingLoadError } from "@/features/onboarding/onboarding-load-error";
import { OnboardingProgress } from "@/features/onboarding/onboarding-progress";
import { ONBOARDING_STEPS, onboardingStepIndex } from "@/features/onboarding/onboarding-steps";
import { OnboardingTimingMark } from "@/features/onboarding/onboarding-timing-mark";
import { parseReturnTo, withReturnTo } from "@/features/onboarding/onboarding-return-to";
import { getOnboardingConsents } from "@/features/onboarding/onboarding-data";

export interface OnboardingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/onboarding` — the flow's entry point and its first step, per-purpose
 * consent (6.2.b). D's `/register` redirects here with `?returnTo=`, which
 * is read once and threaded through every later step
 * (`onboarding-return-to.ts`). Region is chosen at register now, so there is
 * no region step, and no `[region]` URL segment — every page below reads
 * the caller's own account (region, consent, interests, follows) live
 * through `apiFetch`, never a URL param.
 */
export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const returnTo = parseReturnTo((await searchParams).returnTo);
  const consents = await getOnboardingConsents();

  return (
    <div className="flex flex-col gap-6">
      <OnboardingTimingMark mark="signup-start" />
      <OnboardingProgress steps={ONBOARDING_STEPS} currentIndex={onboardingStepIndex("consent")} />
      {consents.ok ? (
        <OnboardingConsentStep initialConsents={consents.data.consents} returnTo={returnTo} />
      ) : (
        <OnboardingLoadError retryHref={withReturnTo("/onboarding", returnTo)} />
      )}
    </div>
  );
}
