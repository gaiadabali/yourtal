import { OnboardingTimingMark } from "@/features/onboarding/onboarding-timing-mark";
import { parseReturnTo } from "@/features/onboarding/onboarding-return-to";
import { RegionPicker } from "@/features/onboarding/region-picker";

export interface OnboardingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/onboarding` — the region step and the flow's entry point (YT-0430).
 * Server Component per docs/13b-typescript-standards.md section 8: the
 * only client code on this screen is the timing beacon, a leaf that
 * renders nothing.
 *
 * `?returnTo=` (YT-0432: Open Viewing's sign-up prompt links here so a
 * finished anonymous viewer lands back on the same campaign, rewarded,
 * after signing up) is read once here and threaded through every later
 * step by `onboarding-return-to.ts`.
 */
export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const returnTo = parseReturnTo((await searchParams).returnTo);
  return (
    <>
      <OnboardingTimingMark mark="signup-start" />
      <RegionPicker returnTo={returnTo} />
    </>
  );
}
