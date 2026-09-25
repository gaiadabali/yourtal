import { formatMoney } from "@yourtal/contracts/money/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@yourtal/ui/card";
import { ReportProvenanceBadge } from "./report-provenance-badge";
import { ReportsBarChart } from "./reports-bar-chart";
import type { RedemptionLedgerSummary } from "./reports-metrics";

export interface ReportsRedemptionLedgerPanelProps {
  summary: RedemptionLedgerSummary;
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
export function ReportsRedemptionLedgerPanel({ summary }: ReportsRedemptionLedgerPanelProps) {
  const nonZeroRows = summary.rows.filter((row) => row.count > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle as="h3">Redemption ledger</CardTitle>
          <CardDescription>
            {summary.totalVoucherCount} voucher{summary.totalVoucherCount === 1 ? "" : "s"} issued
            against this business&rsquo;s own listings. Not attributed to a source campaign — see
            the gap noted below.
          </CardDescription>
        </div>
        <ReportProvenanceBadge provenance="measured" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {nonZeroRows.length === 0 ? (
          <p className="text-sm font-sans text-fg-muted">
            No vouchers have been issued against this business yet.
          </p>
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
            <table className="w-full border-collapse text-left text-sm font-sans">
              <caption className="sr-only">
                Vouchers by status, with total face value per status
              </caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-fg-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Vouchers
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Total face value
                  </th>
                </tr>
              </thead>
              <tbody>
                {nonZeroRows.map((row) => (
                  <tr key={row.status} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 pr-3 font-normal text-fg">
                      {row.label}
                    </th>
                    <td className="py-2 pr-3 text-fg">{row.count}</td>
                    <td className="py-2 pr-3 text-fg">
                      {formatMoney(row.totalFaceValueMinor, row.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
