import { ConsentForm } from "@/features/onboarding/consent-form";
import { OnboardingProgress } from "@/features/onboarding/onboarding-progress";
import { requireRegionParam } from "@/features/onboarding/onboarding-region-param";

export interface OnboardingConsentPageProps {
  params: Promise<{ region: string }>;
}

/** `/onboarding/[region]/consent` — per-purpose consent (YT-0430). Server Component; `ConsentForm` is the one client leaf. */
export default async function OnboardingConsentPage({ params }: OnboardingConsentPageProps) {
  const { region: rawRegion } = await params;
  const region = requireRegionParam(rawRegion);

  return (
    <div className="flex flex-col gap-6">
      <OnboardingProgress current={1} total={4} region={region} />
      <ConsentForm region={region} />
    </div>
  );
}
