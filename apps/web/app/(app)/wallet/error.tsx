"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { ErrorState } from "@yourtal/ui/error-state";
import { PageContainer } from "@yourtal/ui/page-container";

export interface WalletErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Error boundary for `/wallet` (6.5.a). See app/(app)/error.tsx for the same pattern. */
export default function WalletError({ error, reset }: WalletErrorProps) {
  const t = useTranslations("wallet");

  useEffect(() => {
    console.error("Wallet failed to load:", error);
  }, [error]);

  return (
    <PageContainer width="narrow" className="py-6">
      <ErrorState
        title={t("screen.errorTitle")}
        description={t("screen.errorBody")}
        retry={<Button onClick={reset}>{t("screen.retry")}</Button>}
      />
    </PageContainer>
  );
}
