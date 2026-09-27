import { formatMoney } from "@yourtal/contracts/money/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { ReportProvenanceBadge } from "./report-provenance-badge";
import { ReportsBarChart } from "./reports-bar-chart";
import type { RedemptionLedgerSummary } from "./reports-metrics";

export interface ReportsRedemptionLedgerPanelProps {
  summary: RedemptionLedgerSummary;
  locale: SupportedLocale;
}

/**
 * The one panel in this zone backed by a real (mock) ledger fact rather
 * than configuration or an honest gap: a voucher's `status` and
 * `faceValueMinor` on this business's own listings. Deliberately titled
 * "ledger", not "campaign performance" — `voucherSchema` has no
 * `campaignId`, so nothing here can be attributed to a specific campaign
 * (see `reports-unavailable-metrics.ts`'s `campaign-redemption-attribution`
 * entry, always rendered alongside this panel).
 *
 * Each row's total is formatted in that row's OWN currency
 * (`row.currency`, read off the underlying vouchers — YT-0513), never the
 * viewer's region: a business's vouchers are always one region's, so this
 * renders the true currency rather than assuming the viewer shares it.
 */
export function ReportsRedemptionLedgerPanel({
  summary,
  locale,
}: ReportsRedemptionLedgerPanelProps) {
  const t = getStudioTranslator(locale);
  const nonZeroRows = summary.rows.filter((row) => row.count > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle as="h3">{t("reports.ledger.title")}</CardTitle>
          <CardDescription>
            {t("reports.ledger.description", { count: summary.totalVoucherCount })}
          </CardDescription>
        </div>
        <ReportProvenanceBadge provenance="measured" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {nonZeroRows.length === 0 ? (
          <p className="text-sm font-sans text-fg-muted">{t("reports.ledger.empty")}</p>
        ) : (
          <>
            <ReportsBarChart
              rows={nonZeroRows.map((row) => ({
                id: row.status,
                label: row.label,
                value: row.count,
                valueLabel: `${row.count}`,
              }))}
            />
            <DataTable
              caption={t("reports.ledger.caption")}
              rows={nonZeroRows}
              getRowKey={(row) => row.status}
              columns={[
                { key: "status", header: t("reports.ledger.statusHeader"), cell: (row) => row.label },
                { key: "count", header: t("reports.ledger.vouchersHeader"), cell: (row) => row.count },
                {
                  key: "value",
                  header: t("reports.ledger.faceValueHeader"),
                  cell: (row) => formatMoney(row.totalFaceValueMinor, row.currency),
                },
              ]}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
