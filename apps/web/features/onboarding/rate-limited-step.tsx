"use client";

/**
 * Extracted from `phone-verification-flow.tsx` (YT-0525), which sat at 301
 * lines against a 300-line ceiling. One line over is still over, and the
 * flow file was the obvious place to split: it already declared its three
 * steps as separate components, so this moves them rather than redesigning
 * anything.
 */

import { Button } from "@yourtal/ui/button";
import type { OnboardingCopy, OnboardingLocale } from "./onboarding-copy";

interface RateLimitedStepProps {
  copy: OnboardingCopy["verify"];
  locale: OnboardingLocale;
  retryAt: number | null;
  onEditNumber: () => void;
}

export function RateLimitedStep({ copy, locale, retryAt, onEditNumber }: RateLimitedStepProps) {
  const retryLabel =
    retryAt !== null
      ? new Date(retryAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : null;

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-warning bg-warning/10 p-4"
    >
      <p className="text-sm font-sans font-semibold text-warning">{copy.rateLimitedHeading}</p>
      <p className="text-sm font-sans text-fg">{copy.rateLimitedBody}</p>
      {retryLabel !== null ? (
        <p className="text-sm font-sans text-fg">
          {copy.rateLimitedRetryPrefix}{" "}
          <span className="font-semibold tabular-nums">{retryLabel}</span>.
        </p>
      ) : null}
      <Button type="button" variant="secondary" onClick={onEditNumber}>
        {copy.wrongNumber}
      </Button>
    </div>
  );
}
