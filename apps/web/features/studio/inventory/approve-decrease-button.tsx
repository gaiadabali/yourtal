"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { approveSettlementDecreaseAction } from "./inventory-actions";
import { inventoryErrorKey } from "./inventory-errors";

export interface ApproveDecreaseButtonProps {
  businessId: string;
  listingId: string;
  requestId: string;
  listingTitle: string;
}

/**
 * The second approver's button. Shown only to an owner or admin who did not
 * raise the request; the API enforces both, so a refusal is worded, not hidden.
 */
export function ApproveDecreaseButton(props: ApproveDecreaseButtonProps) {
  const t = useTranslations("studio");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveSettlementDecreaseAction(
        props.businessId,
        props.listingId,
        props.requestId,
      );
      if (!result.ok) setError(t(`inventory.error.${inventoryErrorKey(result.code)}`));
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={approve}
        aria-label={t("inventory.approval.approveFor", { title: props.listingTitle })}
      >
        {pending ? t("inventory.approval.approving") : t("inventory.approval.approve")}
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-body-sm font-sans text-danger-solid">
          {error}
        </p>
      )}
    </div>
  );
}
