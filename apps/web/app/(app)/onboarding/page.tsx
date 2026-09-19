import { OnboardingTimingMark } from "@/features/onboarding/onboarding-timing-mark";
import { RegionPicker } from "@/features/onboarding/region-picker";

/**
 * `/onboarding` — the region step and the flow's entry point (YT-0430).
 * Server Component per docs/13b-typescript-standards.md section 8: the only
 * client code on this screen is the timing beacon, a leaf that renders
 * nothing.
 */
export default function OnboardingPage() {
  return (
    <>
      <OnboardingTimingMark mark="signup-start" />
      <RegionPicker />
    </>
  );
}
