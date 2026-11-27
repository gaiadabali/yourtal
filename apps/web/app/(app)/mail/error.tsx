"use client";

import { useEffect } from "react";
import { Button } from "@yourtal/ui/button";
import { ErrorState } from "@yourtal/ui/error-state";

export interface MailErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * The outer safety net for `/mail`: an unexpected render crash, not a failed mail call (those are
 * worded inside the screens). English only: next-intl's request config is not available in an error
 * boundary, matching `app/(app)/me/error.tsx`.
 */
export default function MailError({ error, reset }: MailErrorProps) {
  useEffect(() => {
    console.error("Mail failed to render:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-page-narrow flex-col gap-3 px-gutter-sm py-10">
      <ErrorState
        title="Couldn't load Mail"
        description="Something went wrong. Try again."
        retry={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
