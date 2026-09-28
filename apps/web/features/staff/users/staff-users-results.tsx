import Link from "next/link";
import { Badge } from "@yourtal/ui/badge";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { StatusBadge } from "@yourtal/ui/status-badge";
import type { StaffUserSearchResult } from "@yourtal/contracts/staff/users";

export interface StaffUsersResultsProps {
  readonly t: (key: string) => string;
  readonly results: StaffUserSearchResult;
}

/** TASKS.md 9.4.a: search results, each row a link to that account's own detail screen. */
export function StaffUsersResults({ t, results }: StaffUsersResultsProps) {
  if (results.length === 0) {
    return <EmptyState title={t("users.emptyTitle")} description={t("users.emptyDescription")} />;
  }

  return (
    <DataTable
      caption={t("users.resultsCaption")}
      rows={results}
      getRowKey={(row) => row.userId}
      columns={[
        {
          key: "email",
          header: t("users.columnEmail"),
          cell: (row) => (
            <Link href={`/staff/users/${row.userId}`} className="text-accent underline">
              {row.email ?? row.userId}
            </Link>
          ),
        },
        { key: "region", header: t("users.columnRegion"), cell: (row) => t(`regions.${row.region}`) },
        {
          key: "trustTier",
          header: t("users.columnTrustTier"),
          cell: (row) => <Badge variant="secondary">{row.trustTier}</Badge>,
        },
        {
          key: "status",
          header: t("users.columnStatus"),
          cell: (row) =>
            row.isSuspended ? (
              <StatusBadge status="danger">{t("users.suspended")}</StatusBadge>
            ) : (
              <StatusBadge status="success">{t("users.active")}</StatusBadge>
            ),
        },
      ]}
    />
  );
}
