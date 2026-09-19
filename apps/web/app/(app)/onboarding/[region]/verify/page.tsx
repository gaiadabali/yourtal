import { OnboardingProgress } from "@/features/onboarding/onboarding-progress";
import { requireRegionParam } from "@/features/onboarding/onboarding-region-param";
import { parseReturnTo } from "@/features/onboarding/onboarding-return-to";
import { PhoneVerificationFlow } from "@/features/onboarding/phone-verification-flow";

export interface OnboardingVerifyPageProps {
  params: Promise<{ region: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** `/onboarding/[region]/verify` — phone entry + OTP (YT-0430). Server Component; `PhoneVerificationFlow` is the one client leaf. */
export default async function OnboardingVerifyPage({
  params,
  searchParams,
}: OnboardingVerifyPageProps) {
  const { region: rawRegion } = await params;
  const region = requireRegionParam(rawRegion);
  const returnTo = parseReturnTo((await searchParams).returnTo);

  return (
    <div className="flex flex-col gap-6">
      <OnboardingProgress current={2} total={4} region={region} />
      <PhoneVerificationFlow region={region} returnTo={returnTo} />
    </div>
  );
}
