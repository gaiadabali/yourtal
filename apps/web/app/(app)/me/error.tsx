"use client";

import { useEffect } from "react";
import { Button } from "@yourtal/ui/button";
import { ErrorState } from "@yourtal/ui/error-state";

export interface MeErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * The outer safety net for `/me` (TASKS.md 6.7.a) — an unexpected render
 * crash, not an API failure (every API read already degrades per-section
 * via `MeSectionError`; this only ever catches a bug in the render itself).
 * English only: next-intl's request config isn't available in an error
 * boundary, matching `app/(app)/wallet/error.tsx`'s own precedent.
 */
export default function MeError({ error, reset }: MeErrorProps) {
  useEffect(() => {
    console.error("Me page failed to render:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-page-narrow flex-col gap-3 px-gutter-sm py-10">
      <ErrorState
        title="Couldn't load Me"
        description="Something went wrong. Try again."
        retry={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
