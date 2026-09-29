"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { StaffListingModerationItem } from "@yourtal/contracts/staff/moderation";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { StaffReasonDialogButton } from "../staff-reason-dialog-button";
import {
  approveListingModerationAction,
  rejectListingModerationAction,
} from "./staff-listing-moderation-actions";

export interface StaffListingModerationListProps {
  readonly initial: readonly StaffListingModerationItem[];
}

/**
 * TASKS.md 9.2.a: the listing half of `/staff/moderation`. Only a listing
 * the automated screen flagged (an adult_only `contentCategory`, per 1.1.d)
 * ever appears here -- every other listing is `active` from creation and
 * never reaches this queue at all.
 */
export function StaffListingModerationList({ initial }: StaffListingModerationListProps) {
  const t = useTranslations("staff");
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function decide(
    listingId: string,
    action: (id: string, reason: string) => Promise<{ ok: boolean; error?: { message: string } }>,
    reason: string,
  ): Promise<boolean> {
    const result = await action(listingId, reason);
    if (result.ok) {
      setItems((current) => current.filter((item) => item.id !== listingId));
      setError(null);
      return true;
    }
    setError(result.error?.message ?? t("errors.actionFailed"));
    return false;
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      {items.length === 0 ? (
        <EmptyState
          title={t("moderation.listingsEmptyTitle")}
          description={t("moderation.listingsEmptyDescription")}
        />
      ) : (
        <DataTable
          caption={t("moderation.listingsTableCaption")}
          columns={[
            {
              key: "listing",
              header: t("moderation.columnListing"),
              cell: (row) => (
                <div className="flex flex-col gap-0.5">
                  <Text size="label">{row.title}</Text>
                  <Text size="caption" tone="muted">
                    {row.audience} · {row.contentCategory}
                  </Text>
                </div>
              ),
            },
            {
              key: "merchant",
              header: t("moderation.columnMerchant"),
              cell: (row) => <Text size="body-sm">{row.merchantName}</Text>,
            },
            {
              key: "actions",
              header: t("moderation.columnActions"),
              cell: (row) => (
                <div className="flex flex-wrap gap-2">
                  <StaffReasonDialogButton
                    triggerLabel={t("moderation.approveCta")}
                    triggerVariant="primary"
                    dialogTitle={t("moderation.approveListingDialogTitle")}
                    dialogBody={t("moderation.approveListingDialogBody")}
                    submitLabel={t("moderation.approveListingSubmit")}
                    onSubmit={(reason) => decide(row.id, approveListingModerationAction, reason)}
                  />
                  <StaffReasonDialogButton
                    triggerLabel={t("moderation.rejectCta")}
                    triggerVariant="danger"
                    dialogTitle={t("moderation.rejectListingDialogTitle")}
                    dialogBody={t("moderation.rejectListingDialogBody")}
                    submitLabel={t("moderation.rejectListingSubmit")}
                    onSubmit={(reason) => decide(row.id, rejectListingModerationAction, reason)}
                  />
                </div>
              ),
            },
          ]}
          rows={[...items]}
          getRowKey={(row) => row.id}
        />
      )}
    </div>
  );
}
