import { Progress } from "@yourtal/ui/progress";
import type { Region } from "@yourtal/contracts/region";
import { regionDisplayConfig } from "@/features/region/region-config";
import { getOnboardingCopy } from "./onboarding-copy";

export interface OnboardingProgressProps {
  current: number;
  total: number;
  region: Region;
}

/**
 * "Step N of 4" orientation, shown on every screen after the region picker.
 * A visible sense of remaining steps matters for the 60-second signup
 * budget (docs/tasks/phase-u-ui.md YT-0430) — perceived speed, not just
 * actual speed. Mirrors `features/checkpoint/checkpoint-progress.tsx`'s
 * label-plus-bar pattern.
 */
export function OnboardingProgress({ current, total, region }: OnboardingProgressProps) {
  const { locale } = regionDisplayConfig(region);
  const { stepPrefix, stepJoiner } = getOnboardingCopy(locale).common;
  const label = `${stepPrefix} ${current} ${stepJoiner} ${total}`;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-sans font-medium text-fg-muted">{label}</p>
      <Progress value={current} max={total} aria-label={label} />
    </div>
  );
}
