"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { CampaignErrorPanel } from "@/features/campaign/campaign-error-panel";

export interface EarnBoardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary for the Earn board (YT-0410). Next.js requires this exact
 * filename and a `"use client"` default export receiving `{ error, reset }`
 * (docs/13b-typescript-standards.md §8: "every async subtree gets an
 * explicit ... error boundary"). Today this fires for real when
 * `YOURTAL_DATA_SOURCE=live` is set, since no BFF exists yet — see
 * campaign-data.ts.
 */
export default function EarnBoardError({ error, reset }: EarnBoardErrorProps) {
  const t = useTranslations("campaign");
  useEffect(() => {
    console.error("Earn board failed to load:", error);
  }, [error]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold text-fg">{t("board.title")}</h1>
      <CampaignErrorPanel
        title={t("boardError.title")}
        description={t("boardError.description")}
        onRetry={reset}
      />
    </div>
  );
}
