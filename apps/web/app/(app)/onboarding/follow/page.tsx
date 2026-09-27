import { OnboardingFollowStep } from "@/features/onboarding/onboarding-follow-step";
import { OnboardingLoadError } from "@/features/onboarding/onboarding-load-error";
import { OnboardingProgress } from "@/features/onboarding/onboarding-progress";
import { ONBOARDING_STEPS, onboardingStepIndex } from "@/features/onboarding/onboarding-steps";
import { parseReturnTo, withReturnTo } from "@/features/onboarding/onboarding-return-to";
import { getFollowCandidates } from "@/features/onboarding/onboarding-data";

export interface OnboardingFollowPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** `/onboarding/follow` — "follow 3 channels" (6.2.b): real businesses in the caller's own region. */
export default async function OnboardingFollowPage({ searchParams }: OnboardingFollowPageProps) {
  const returnTo = parseReturnTo((await searchParams).returnTo);
  const candidates = await getFollowCandidates();

  return (
    <div className="flex flex-col gap-6">
      <OnboardingProgress steps={ONBOARDING_STEPS} currentIndex={onboardingStepIndex("follow")} />
      {candidates.ok ? (
        <OnboardingFollowStep candidates={candidates.data.candidates} returnTo={returnTo} />
      ) : (
        <OnboardingLoadError retryHref={withReturnTo("/onboarding/follow", returnTo)} />
      )}
    </div>
  );
}
