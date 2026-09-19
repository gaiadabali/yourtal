import { InterestPicker } from "@/features/onboarding/interest-picker";
import { OnboardingProgress } from "@/features/onboarding/onboarding-progress";
import { requireRegionParam } from "@/features/onboarding/onboarding-region-param";

export interface OnboardingInterestsPageProps {
  params: Promise<{ region: string }>;
}

/** `/onboarding/[region]/interests` — the interest picker (YT-0430). Server Component; `InterestPicker` is the one client leaf. */
export default async function OnboardingInterestsPage({ params }: OnboardingInterestsPageProps) {
  const { region: rawRegion } = await params;
  const region = requireRegionParam(rawRegion);

  return (
    <div className="flex flex-col gap-6">
      <OnboardingProgress current={3} total={4} region={region} />
      <InterestPicker region={region} />
    </div>
  );
}
