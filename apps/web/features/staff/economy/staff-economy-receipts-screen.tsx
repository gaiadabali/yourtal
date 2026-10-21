import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { KeyValue } from "@yourtal/ui/key-value";
import type { ReceiptProgrammeRow } from "@yourtal/contracts/staff/economy";

export interface StaffEconomyReceiptsScreenProps {
  readonly t: (key: string, values?: Record<string, string | number>) => string;
  readonly programmes: readonly ReceiptProgrammeRow[];
}

/**
 * 2.9.c: SnapApp's receipt programme. One card per partner with an approved
 * funder in the region: its receipt packages (left of total), what they paid
 * (all time and the last 7 days) and the top earners over 30 days. Earners are
 * the ledger's opaque account ids, never an email. Nothing here names the rate.
 */
export function StaffEconomyReceiptsScreen({ t, programmes }: StaffEconomyReceiptsScreenProps) {
  if (programmes.length === 0) {
    return (
      <EmptyState
        title={t("economy.receipts.emptyTitle")}
        description={t("economy.receipts.emptyBody")}
      />
    );
  }
  const points = (count: number) => t("economy.receipts.points", { count });

  return (
    <div className="flex flex-col gap-6">
      {programmes.map((programme) => (
        <Card key={programme.partnerId}>
          <CardHeader>
            <CardTitle as="h2">
              {t("economy.receipts.partnerTitle", { partnerId: programme.partnerId })}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <KeyValue
              items={[
                {
                  key: "funder",
                  label: t("economy.receipts.funder"),
                  value:
                    programme.funderName === ""
                      ? t("economy.receipts.funderUnknown")
                      : programme.funderName,
                },
                {
                  key: "perReceipt",
                  label: t("economy.receipts.pointsPerReceipt"),
                  value: points(programme.pointsPerReceipt),
                },
                {
                  key: "paid",
                  label: t("economy.receipts.paidAllTime"),
                  value: points(programme.paidPoints),
                },
                {
                  key: "paid7",
                  label: t("economy.receipts.paidLast7Days"),
                  value: points(programme.paidLast7Days),
                },
              ]}
            />

            {programme.packages.length === 0 ? (
              <EmptyState title={t("economy.receipts.packagesEmpty")} />
            ) : (
              <DataTable
                caption={t("economy.receipts.packagesTitle")}
                rows={[...programme.packages]}
                getRowKey={(row) => row.allocationId}
                columns={[
                  {
                    key: "left",
                    header: t("economy.receipts.packageLeft"),
                    cell: (row) =>
                      t("economy.receipts.packageLeftOfTotal", {
                        left: row.remainingPoints,
                        total: row.totalPoints,
                      }),
                  },
                  {
                    key: "total",
                    header: t("economy.receipts.packageTotal"),
                    cell: (row) => points(row.totalPoints),
                  },
                  {
                    key: "bought",
                    header: t("economy.receipts.packageBought"),
                    cell: (row) => row.boughtAt.slice(0, 10),
                  },
                ]}
              />
            )}

            {programme.topEarners.length === 0 ? (
              <EmptyState title={t("economy.receipts.earnersEmpty")} />
            ) : (
              <DataTable
                caption={t("economy.receipts.earnersTitle")}
                rows={[...programme.topEarners]}
                getRowKey={(row) => row.userId}
                columns={[
                  {
                    key: "account",
                    header: t("economy.receipts.earnerAccount"),
                    cell: (row) => row.userId,
                  },
                  {
                    key: "points",
                    header: t("economy.receipts.earnerPoints"),
                    cell: (row) => points(row.points),
                  },
                  {
                    key: "receipts",
                    header: t("economy.receipts.earnerReceipts"),
                    cell: (row) => row.receipts,
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
