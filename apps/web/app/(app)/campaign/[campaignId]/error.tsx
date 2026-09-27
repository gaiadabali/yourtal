"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { CampaignErrorPanel } from "@/features/campaign/campaign-error-panel";

export interface CampaignEntryErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Error boundary for the campaign entry card (YT-0411). See app/(app)/error.tsx for the same pattern. */
export default function CampaignEntryError({ error, reset }: CampaignEntryErrorProps) {
  const t = useTranslations("campaign");
  useEffect(() => {
    console.error("Campaign entry card failed to load:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <CampaignErrorPanel
        title={t("entryError.title")}
        description={t("entryError.description")}
        onRetry={reset}
      />
    </div>
  );
}
