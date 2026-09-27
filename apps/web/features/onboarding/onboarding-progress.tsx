import { useTranslations } from "next-intl";
import { Stepper } from "@yourtal/ui/stepper";

export type OnboardingStepKey = "consent" | "interests" | "follow" | "done";

export interface OnboardingProgressProps {
  /** The steps this run of the flow actually has — "interests" is left out entirely when ad-targeting consent was not granted, rather than shown and skipped. */
  steps: readonly OnboardingStepKey[];
  currentIndex: number;
}

/**
 * "Step N of M" (docs/tasks/phase-u-ui.md YT-0430's 60-second signup budget:
 * a visible sense of remaining steps matters for perceived speed as much as
 * actual speed) — now the shared `Stepper` primitive instead of a bespoke
 * label-plus-bar, and locale comes from next-intl rather than a `region`
 * prop (6.1.b: display language is independent of region).
 */
export function OnboardingProgress({ steps, currentIndex }: OnboardingProgressProps) {
  const t = useTranslations("onboarding.progress");
  return (
    <Stepper
      steps={steps.map((key) => ({ key, label: t(key) }))}
      currentIndex={currentIndex}
      aria-label={t(steps[currentIndex] ?? "consent")}
    />
  );
}
