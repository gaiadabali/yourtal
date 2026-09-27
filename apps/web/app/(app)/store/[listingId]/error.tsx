"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { StoreErrorPanel } from "@/features/store/store-error-panel";

export interface StoreOfferErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Error boundary for the offer detail page (YT-0421). See app/(app)/store/error.tsx for the same pattern. */
export default function StoreOfferError({ error, reset }: StoreOfferErrorProps) {
  const t = useTranslations("store");
  useEffect(() => {
    console.error("Offer detail page failed to load:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <StoreErrorPanel
        title={t("offerError.title")}
        description={t("offerError.description")}
        onRetry={reset}
      />
    </div>
  );
}
