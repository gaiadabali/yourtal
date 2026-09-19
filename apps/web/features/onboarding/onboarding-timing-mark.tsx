"use client";

import { useEffect } from "react";
import { recordOnboardingMark } from "./onboarding-timing";
import type { OnboardingTimingMark as MarkName } from "./onboarding-timing";

export interface OnboardingTimingMarkProps {
  mark: MarkName;
}

/**
 * Renders nothing. Records a Performance API mark on mount so the timed
 * acceptance criteria in YT-0430 (60 s signup, 15 s interest picker) are
 * measurable in a real browser — see `onboarding-timing.ts`'s doc comment.
 * The smallest possible client leaf: no state, no children, one effect.
 */
export function OnboardingTimingMark({ mark }: OnboardingTimingMarkProps) {
  useEffect(() => {
    recordOnboardingMark(mark);
  }, [mark]);
  return null;
}
