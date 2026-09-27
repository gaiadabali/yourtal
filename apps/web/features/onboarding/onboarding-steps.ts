import type { OnboardingStepKey } from "./onboarding-progress";

/**
 * The flow's fixed step order for `OnboardingProgress` (6.2.b): consent,
 * interests, follow, done. Always all four, even for a run that SKIPS
 * interests (no `declared_interest_targeting` consent) — the alternative,
 * a variable-length step list, would have the indicator itself reshape
 * mid-flow depending on a choice the stepper is not about. A skipped step
 * simply never becomes "current" or "complete" on this run.
 */
export const ONBOARDING_STEPS: readonly OnboardingStepKey[] = [
  "consent",
  "interests",
  "follow",
  "done",
];

export function onboardingStepIndex(step: OnboardingStepKey): number {
  return ONBOARDING_STEPS.indexOf(step);
}
