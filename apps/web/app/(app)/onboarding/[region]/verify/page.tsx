import { OnboardingProgress } from "@/features/onboarding/onboarding-progress";
import { requireRegionParam } from "@/features/onboarding/onboarding-region-param";
import { PhoneVerificationFlow } from "@/features/onboarding/phone-verification-flow";

export interface OnboardingVerifyPageProps {
  params: Promise<{ region: string }>;
}

/** `/onboarding/[region]/verify` — phone entry + OTP (YT-0430). Server Component; `PhoneVerificationFlow` is the one client leaf. */
export default async function OnboardingVerifyPage({ params }: OnboardingVerifyPageProps) {
  const { region: rawRegion } = await params;
  const region = requireRegionParam(rawRegion);

  return (
    <div className="flex flex-col gap-6">
      <OnboardingProgress current={2} total={4} region={region} />
      <PhoneVerificationFlow region={region} />
    </div>
  );
}
