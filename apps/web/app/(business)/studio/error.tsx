"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";

export interface StudioErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary for Studio. Next.js requires this exact filename and a
 * `"use client"` default export receiving `{ error, reset }`. Fires for real
 * today when `YOURTAL_DATA_SOURCE=live` is set for a zone whose API has not
 * landed yet (each zone's own `*-data.ts` live source rejects until then).
 */
export default function StudioError({ error, reset }: StudioErrorProps) {
  const t = useTranslations("studio");
  useEffect(() => {
    console.error("Studio failed to load:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold text-fg">YourTal Studio</h1>
      <p className="text-sm font-sans text-fg-muted">
        {t("chrome.error.message")}
      </p>
      <Button type="button" onClick={reset} className="w-fit">
        {t("chrome.error.retry")}
      </Button>
    </div>
  );
}
