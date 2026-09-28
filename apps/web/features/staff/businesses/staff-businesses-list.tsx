import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { StaffBusinessSummary } from "@yourtal/contracts/staff/businesses";
import { Button } from "@yourtal/ui/button";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Input } from "@yourtal/ui/input";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Text } from "@yourtal/ui/text";

export interface StaffBusinessesListProps {
  readonly businesses: readonly StaffBusinessSummary[];
  readonly total: number;
  readonly search: string;
}

/**
 * TASKS.md 9.3.a: search is a plain `<form method="get">` -- the page itself
 * re-fetches on the resulting `?search=` navigation (`page.tsx`'s own
 * `searchParams`), so this list needs no client JS to filter.
 */
export async function StaffBusinessesList({ businesses, total, search }: StaffBusinessesListProps) {
  const t = await getTranslations("staff");
  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <Input
          label={t("businesses.searchLabel")}
          name="search"
          type="search"
          defaultValue={search}
          className="max-w-xs"
        />
        <Button type="submit" variant="secondary">
          {t("businesses.searchSubmit")}
        </Button>
      </form>
      <Text tone="muted" size="caption">
        {t("businesses.resultCount", { count: total })}
      </Text>
      {businesses.length === 0 ? (
        <EmptyState
          title={t("businesses.emptyTitle")}
          description={t("businesses.emptyDescription")}
        />
      ) : (
        <DataTable
          caption={t("businesses.tableCaption")}
          columns={[
            {
              key: "name",
              header: t("businesses.columnName"),
              cell: (row) => (
                <Link
                  href={`/staff/businesses/${row.id}`}
                  className="font-sans font-medium text-fg underline-offset-2 hover:underline"
                >
                  {row.displayName}
                </Link>
              ),
            },
            {
              key: "region",
              header: t("businesses.columnRegion"),
              cell: (row) => t(`regions.${row.region}`),
            },
            {
              key: "kyb",
              header: t("businesses.columnKyb"),
              cell: (row) => (
                <StatusBadge status={row.isVerified ? "success" : "neutral"}>
                  {row.isVerified ? t("businesses.verified") : t("businesses.unverified")}
                </StatusBadge>
              ),
            },
            {
              key: "status",
              header: t("businesses.columnStatus"),
              cell: (row) =>
                row.suspendedAt === null ? (
                  <StatusBadge status="info">{t("businesses.active")}</StatusBadge>
                ) : (
                  <StatusBadge status="danger">{t("businesses.suspended")}</StatusBadge>
                ),
            },
          ]}
          rows={[...businesses]}
          getRowKey={(row) => row.id}
        />
      )}
    </div>
  );
}
