"use client";

import { useEffect } from "react";
import { Button } from "@yourtal/ui/button";

export interface OnboardingErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Error boundary for the whole `/onboarding` flow. See `app/(app)/error.tsx` for the same pattern. */
export default function OnboardingError({ error, reset }: OnboardingErrorProps) {
  useEffect(() => {
    console.error("Onboarding failed to load:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center">
      <h1 className="text-lg font-sans font-semibold text-fg">
        Something went wrong / Terjadi kesalahan
      </h1>
      <p className="max-w-sm text-sm font-sans text-fg-muted">
        Please try again. / Silakan coba lagi.
      </p>
      <Button onClick={reset}>Retry / Coba lagi</Button>
    </div>
  );
}
