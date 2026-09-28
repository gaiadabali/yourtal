"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { StaffVoucherBatchRequest } from "@yourtal/contracts/staff/moderation";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { StaffReasonDialogButton } from "../staff-reason-dialog-button";
import { approveVoucherBatchAction, rejectVoucherBatchAction } from "./staff-voucher-batch-actions";

export interface StaffVoucherBatchListProps {
  readonly initial: readonly StaffVoucherBatchRequest[];
}

/**
 * TASKS.md 9.2.c: the voucher-batch half of `/staff/moderation` -- the rest
 * of the moderation queue (9.2.a) waits on 7.3 and is not this component's
 * scope. A decided request drops out of the list (it was only ever showing
 * `pending` ones), so approve/reject remove their own row rather than
 * updating it in place.
 */
export function StaffVoucherBatchList({ initial }: StaffVoucherBatchListProps) {
  const t = useTranslations("staff");
  const [requests, setRequests] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function decide(
    requestId: string,
    action: (
      id: string,
      reason: string,
    ) => Promise<{
      ok: boolean;
      error?: { message: string };
    }>,
    reason: string,
  ): Promise<boolean> {
    const result = await action(requestId, reason);
    if (result.ok) {
      setRequests((current) => current.filter((request) => request.id !== requestId));
      setError(null);
      return true;
    }
    setError(result.error?.message ?? t("errors.actionFailed"));
    return false;
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      {requests.length === 0 ? (
        <EmptyState
          title={t("moderation.emptyTitle")}
          description={t("moderation.emptyDescription")}
        />
      ) : (
        <DataTable
          caption={t("moderation.tableCaption")}
          columns={[
            {
              key: "listing",
              header: t("moderation.columnListing"),
              cell: (row) => <Text size="body-sm">{row.listingId}</Text>,
            },
            {
              key: "quantity",
              header: t("moderation.columnQuantity"),
              cell: (row) => row.quantity,
            },
            {
              key: "reason",
              header: t("moderation.columnReason"),
              cell: (row) => (
                <Text size="body-sm" tone="muted">
                  {row.reason ?? "—"}
                </Text>
              ),
            },
            {
              key: "requested",
              header: t("moderation.columnRequested"),
              cell: (row) => new Date(row.createdAt).toLocaleDateString(),
            },
            {
              key: "actions",
              header: t("moderation.columnActions"),
              cell: (row) => (
                <div className="flex flex-wrap gap-2">
                  <StaffReasonDialogButton
                    triggerLabel={t("moderation.approveCta")}
                    triggerVariant="primary"
                    dialogTitle={t("moderation.approveDialogTitle")}
                    dialogBody={t("moderation.approveDialogBody")}
                    submitLabel={t("moderation.approveSubmit")}
                    onSubmit={(reason) => decide(row.id, approveVoucherBatchAction, reason)}
                  />
                  <StaffReasonDialogButton
                    triggerLabel={t("moderation.rejectCta")}
                    triggerVariant="danger"
                    dialogTitle={t("moderation.rejectDialogTitle")}
                    dialogBody={t("moderation.rejectDialogBody")}
                    submitLabel={t("moderation.rejectSubmit")}
                    onSubmit={(reason) => decide(row.id, rejectVoucherBatchAction, reason)}
                  />
                </div>
              ),
            },
          ]}
          rows={[...requests]}
          getRowKey={(row) => row.id}
        />
      )}
    </div>
  );
}
