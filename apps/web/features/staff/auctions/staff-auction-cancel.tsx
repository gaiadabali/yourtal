"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { StaffReasonDialogButton } from "../staff-reason-dialog-button";
import { cancelAuctionAction } from "./staff-auction-actions";

/** 13.22.g: the Cancel button, with a required reason. */
export function StaffAuctionCancel({ auctionId, title }: { auctionId: string; title: string }) {
  const t = useTranslations("staff");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StaffReasonDialogButton
        triggerLabel={t("auctions.cancel")}
        triggerVariant="danger"
        dialogTitle={t("auctions.cancelTitle", { title })}
        dialogBody={t("auctions.cancelBody")}
        submitLabel={t("auctions.cancel")}
        onSubmit={async (reason) => {
          const result = await cancelAuctionAction(auctionId, reason);
          if (!result.ok) {
            setError(t("auctions.failed", { message: result.message }));
            return false;
          }
          setError(null);
          router.refresh();
          return true;
        }}
      />
      {error === null ? null : (
        <p role="alert" className="font-sans text-body-sm text-danger-solid">
          {error}
        </p>
      )}
    </div>
  );
}
