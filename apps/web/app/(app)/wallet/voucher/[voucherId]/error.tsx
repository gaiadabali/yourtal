"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { ErrorState } from "@yourtal/ui/error-state";
import { PageContainer } from "@yourtal/ui/page-container";

export interface WalletVoucherDetailErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Error boundary for the voucher detail screen (6.5.b). See app/(app)/error.tsx for the same pattern. */
export default function WalletVoucherDetailError({ error, reset }: WalletVoucherDetailErrorProps) {
  const t = useTranslations("wallet");

  useEffect(() => {
    console.error("Voucher detail failed to load:", error);
  }, [error]);

  return (
    <PageContainer width="narrow" className="py-6">
      <ErrorState
        title={t("voucherDetail.errorTitle")}
        description={t("voucherDetail.errorBody")}
        retry={<Button onClick={reset}>{t("screen.retry")}</Button>}
      />
    </PageContainer>
  );
}
