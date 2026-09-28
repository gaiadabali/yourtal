import Link from "next/link";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import type { StaffDisputeQueue } from "@yourtal/contracts/staff/disputes";

export interface StaffDisputesListProps {
  readonly t: (key: string) => string;
  readonly disputes: StaffDisputeQueue;
}

/** TASKS.md 9.4.d, K13: the queue, oldest first -- list-only, resolving one is 10.5. */
export function StaffDisputesList({ t, disputes }: StaffDisputesListProps) {
  if (disputes.length === 0) {
    return <EmptyState title={t("disputes.emptyTitle")} description={t("disputes.emptyDescription")} />;
  }

  return (
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
      ]}
    />
  );
}
