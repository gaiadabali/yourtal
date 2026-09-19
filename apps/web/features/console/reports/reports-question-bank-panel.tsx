import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@yourtal/ui/card";
import { ReportProvenanceBadge } from "./report-provenance-badge";
import { ReportsBarChart } from "./reports-bar-chart";
import type { QuestionTypeCount } from "./reports-metrics";

export interface ReportsQuestionBankPanelProps {
  /** What the chart/table below are scoped to — a campaign title, or "All campaigns". */
  scopeLabel: string;
  typeCounts: readonly QuestionTypeCount[];
}

/**
 * Question bank COMPOSITION — what the business configured, never a
 * result of anyone answering anything (there is no response record in
 * `packages/contracts` to compute accuracy or recall from; see
 * `reports-unavailable-metrics.ts`). The bar chart is decorative
 * (`aria-hidden`, see `reports-bar-chart.tsx`); the table beneath it is
 * the real, accessible data.
 */
export function ReportsQuestionBankPanel({
  scopeLabel,
  typeCounts,
}: ReportsQuestionBankPanelProps) {
  const total = typeCounts.reduce((sum, row) => sum + row.count, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle as="h3">Question bank composition</CardTitle>
          <CardDescription>{scopeLabel}</CardDescription>
        </div>
        <ReportProvenanceBadge provenance="configured" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {total === 0 ? (
          <p className="text-sm font-sans text-fg-muted">
            No questions are configured in this scope.
          </p>
        ) : (
          <>
            <ReportsBarChart
              rows={typeCounts.map((row) => ({
                id: row.type,
                label: row.label,
                value: row.count,
                valueLabel: `${row.count}`,
              }))}
            />
            <table className="w-full border-collapse text-left text-sm font-sans">
              <caption className="sr-only">Question count by type for {scopeLabel}</caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-fg-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Question type
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Count
                  </th>
                </tr>
              </thead>
              <tbody>
                {typeCounts.map((row) => (
                  <tr key={row.type} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 pr-3 font-normal text-fg">
                      {row.label}
                    </th>
                    <td className="py-2 pr-3 text-fg">{row.count}</td>
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
