import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Input } from "@yourtal/ui/input";
import { KeyValue } from "@yourtal/ui/key-value";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { Notice } from "@yourtal/ui/notice";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Textarea } from "@yourtal/ui/textarea";
import type { EconomyOverview } from "@yourtal/contracts/staff/economy";
import { approveManualPurchaseAction, proposeManualPurchaseAction } from "./staff-economy-actions";

export interface StaffEconomyOverviewScreenProps {
  readonly t: (key: string, values?: Record<string, string | number>) => string;
  readonly region: "AU" | "ID";
  readonly overview: EconomyOverview;
  readonly canRecordPurchase: boolean;
  readonly currentStaffId: string;
  readonly idempotencyKey: string;
  readonly flash: string | undefined;
}

const FLASH_TONE: Record<string, "success" | "danger" | "warning"> = {
  proposed: "success",
  approved: "success",
  error: "danger",
  invalid: "warning",
};

/** TASKS.md 9.5.a: coverage, daily issuance/burn, reserve, reported spread, and 9.5.c's manual purchase queue. */
export function StaffEconomyOverviewScreen({
  t,
  region,
  overview,
  canRecordPurchase,
  currentStaffId,
  idempotencyKey,
  flash,
}: StaffEconomyOverviewScreenProps) {
  const { coverage, dailySeries, reportedSpread, manualPurchases } = overview;
  const pendingPurchases = manualPurchases.filter((p) => p.status === "pending");

  return (
    <div className="flex flex-col gap-6">
      {flash === undefined ? null : (
        <Notice tone={FLASH_TONE[flash] ?? "info"}>{t(`economy.flash.${flash}`)}</Notice>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("economy.coverageTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValue
            items={[
              {
                key: "ratio",
                label: t("economy.coverageRatio"),
                value: coverage.nothingOwed
                  ? t("economy.nothingOwed")
                  : `${(coverage.ratio * 100).toFixed(1)}%`,
              },
              {
                key: "reserve",
                label: t("economy.reserve"),
                value: <MoneyAmount amountMinor={coverage.reserveMinor} currency={reportedSpread.currency} />,
              },
              {
                key: "outstanding",
                label: t("economy.pointsOutstanding"),
                value: coverage.pointsOutstanding.toLocaleString(),
              },
              {
                key: "spread",
                label: t("economy.reportedSpread"),
                value: (
                  <MoneyAmount amountMinor={reportedSpread.amountMinor} currency={reportedSpread.currency} />
                ),
              },
              {
                key: "status",
                label: t("economy.coverageStatus"),
                value:
                  coverage.ratio >= 1 ? (
                    <StatusBadge status="success">{t("economy.covered")}</StatusBadge>
                  ) : (
                    <StatusBadge status="danger">{t("economy.underCovered")}</StatusBadge>
                  ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("economy.dailyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {dailySeries.length === 0 ? (
            <EmptyState title={t("economy.dailyEmptyTitle")} />
          ) : (
            <DataTable
              caption={t("economy.dailyTitle")}
              rows={dailySeries}
              getRowKey={(row) => row.date}
              columns={[
                { key: "date", header: t("economy.dailyDate"), cell: (row) => row.date },
                {
                  key: "issued",
                  header: t("economy.dailyIssued"),
                  cell: (row) => row.pointsIssued.toLocaleString(),
                },
                {
                  key: "redeemed",
                  header: t("economy.dailyRedeemed"),
                  cell: (row) => row.pointsRedeemed.toLocaleString(),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("economy.purchasesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {manualPurchases.length === 0 ? (
            <EmptyState title={t("economy.purchasesEmptyTitle")} />
          ) : (
            <DataTable
              caption={t("economy.purchasesTitle")}
              rows={manualPurchases}
              getRowKey={(row) => row.id}
              columns={[
                { key: "summary", header: t("economy.purchaseSummary"), cell: (row) => row.summary },
                {
                  key: "status",
                  header: t("economy.columnStatus"),
                  cell: (row) => t(`economy.status.${row.status}`),
                },
                {
                  key: "action",
                  header: t("economy.columnActions"),
                  cell: (row) =>
                    row.status === "pending" && row.proposedBy !== currentStaffId ? (
                      <form action={approveManualPurchaseAction}>
                        <input type="hidden" name="region" value={region} />
                        <input type="hidden" name="proposalId" value={row.id} />
                        <input type="hidden" name="idempotencyKey" value={`${idempotencyKey}:${row.id}`} />
                        <Button type="submit" size="sm">
                          {t("economy.approveCta")}
                        </Button>
                      </form>
                    ) : row.status === "pending" ? (
                      t("economy.awaitingSecondApprover")
                    ) : null,
                },
              ]}
            />
          )}
          {pendingPurchases.length === 0 ? null : (
            <p className="text-body-sm text-fg-muted">{t("economy.pendingCount", { count: pendingPurchases.length })}</p>
          )}
        </CardContent>
      </Card>

      {canRecordPurchase ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("economy.recordPurchaseTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={proposeManualPurchaseAction} className="flex flex-col gap-3">
              <input type="hidden" name="region" value={region} />
              <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
              <Input name="businessId" label={t("economy.purchaseBusinessId")} required />
              <Input type="number" name="points" label={t("economy.purchasePoints")} min={1} required />
              <Input
                type="number"
                name="paidMinor"
                label={t("economy.purchasePaidMinor")}
                min={1}
                required
              />
              <Input name="bankReference" label={t("economy.purchaseBankReference")} required />
              <Textarea name="reason" label={t("economy.optionalReasonLabel")} />
              <Button type="submit" className="w-fit">
                {t("economy.recordPurchaseSubmit")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
