"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { ErrorState } from "@yourtal/ui/error-state";
import { Button } from "@yourtal/ui/button";

export interface WatchGridErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary for the Watch grid (11.7.d). Scoped to `watch/`, so it
 * never shadows `watch/[campaignId]/error.tsx` (that segment defines its
 * own) and is never shadowed by it either — Next.js matches the closest
 * `error.tsx` to where the throw happened.
 */
export default function WatchGridError({ error, reset }: WatchGridErrorProps) {
  const t = useTranslations("watch");
  useEffect(() => {
    console.error("Watch grid failed to load:", error);
  }, [error]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold text-fg">{t("title")}</h1>
      <ErrorState
        title={t("error.heading")}
        description={t("error.body")}
        retry={<Button onClick={reset}>{t("error.retry")}</Button>}
      />
    </div>
  );
}
