"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Notice } from "@yourtal/ui/notice";
import type { StaffDisputeQueue } from "@yourtal/contracts/staff/disputes";
import { StaffReasonDialogButton } from "../staff-reason-dialog-button";
import { resolveDisputeAction } from "./staff-disputes-actions";

export interface StaffDisputesListProps {
  readonly disputes: StaffDisputeQueue;
}

/**
 * TASKS.md 9.4.d, K13 / 10.5.b: the queue, oldest first, plus resolving one
 * in the user's favour (posts the ledger's recovery line against the
 * merchant). A resolved dispute drops out of the list, the same shape
 * `staff-risk-list.tsx`'s release/suspend already use.
 */
export function StaffDisputesList({ disputes: initial }: StaffDisputesListProps) {
  const t = useTranslations("staff");
  const [disputes, setDisputes] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function resolve(voucherId: string, reason: string): Promise<boolean> {
    const result = await resolveDisputeAction(voucherId, reason);
    if (result.ok) {
      setDisputes((current) => current.filter((dispute) => dispute.voucherId !== voucherId));
      setError(null);
      return true;
    }
    setError(result.error.message);
    return false;
  }

  if (disputes.length === 0) {
    return (
      <EmptyState title={t("disputes.emptyTitle")} description={t("disputes.emptyDescription")} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      <DataTable
        caption={t("disputes.title")}
        rows={disputes}
        getRowKey={(row) => row.voucherId}
        columns={[
          { key: "voucherId", header: t("disputes.columnVoucher"), cell: (row) => row.voucherId },
          {
            key: "userId",
            header: t("disputes.columnUser"),
            cell: (row) => (
              <Link href={`/staff/users/${row.userId}`} className="text-accent underline">
                {row.userId}
              </Link>
            ),
          },
          {
            key: "region",
            header: t("disputes.columnRegion"),
            cell: (row) => (row.region === null ? "—" : t(`regions.${row.region}`)),
          },
          {
            key: "reason",
            header: t("disputes.columnReason"),
            cell: (row) => t(`disputes.reasons.${row.reason}`),
          },
          {
            key: "createdAt",
            header: t("disputes.columnCreatedAt"),
            cell: (row) => new Date(row.createdAt).toLocaleString(),
          },
          {
            key: "actions",
            header: t("disputes.columnActions"),
            cell: (row) => (
              <StaffReasonDialogButton
                triggerLabel={t("disputes.resolveCta")}
                dialogTitle={t("disputes.resolveDialogTitle")}
                dialogBody={t("disputes.resolveDialogBody")}
                submitLabel={t("disputes.resolveSubmit")}
                onSubmit={(reason) => resolve(row.voucherId, reason)}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
