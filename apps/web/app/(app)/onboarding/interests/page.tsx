import { redirect } from "next/navigation";
import type { Route } from "next";
import { apiFetch } from "@/lib/api/api-fetch";
import { interestsResponseSchema } from "@/features/me/me-schemas";
import { OnboardingInterestsStep } from "@/features/onboarding/onboarding-interests-step";
import { OnboardingLoadError } from "@/features/onboarding/onboarding-load-error";
import { OnboardingProgress } from "@/features/onboarding/onboarding-progress";
import { ONBOARDING_STEPS, onboardingStepIndex } from "@/features/onboarding/onboarding-steps";
import { parseReturnTo, withReturnTo } from "@/features/onboarding/onboarding-return-to";
import { getOnboardingConsents } from "@/features/onboarding/onboarding-data";

export interface OnboardingInterestsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/onboarding/interests` — shown only when the consent step (6.2.b)
 * granted `declared_interest_targeting`. Guarded here rather than only by
 * the consent step's own redirect, so a direct visit (a back button, a
 * bookmarked link) still respects the caller's actual choice instead of
 * showing a picker for a purpose they never consented to.
 */
export default async function OnboardingInterestsPage({
  searchParams,
}: OnboardingInterestsPageProps) {
  const returnTo = parseReturnTo((await searchParams).returnTo);
  const consents = await getOnboardingConsents();
  const adTargetingGranted =
    consents.ok &&
    consents.data.consents.some(
      (entry) => entry.purpose === "declared_interest_targeting" && entry.state === "granted",
    );
  if (!adTargetingGranted) {
    redirect(withReturnTo("/onboarding/follow", returnTo) as Route);
  }

  const interests = await apiFetch("/api/me/interests", interestsResponseSchema);

  return (
    <div className="flex flex-col gap-6">
      <OnboardingProgress
        steps={ONBOARDING_STEPS}
        currentIndex={onboardingStepIndex("interests")}
      />
      {interests.ok ? (
        <OnboardingInterestsStep initialNodeIds={interests.data.nodeIds} returnTo={returnTo} />
      ) : (
        <OnboardingLoadError retryHref={withReturnTo("/onboarding/interests", returnTo)} />
      )}
    </div>
  );
}
