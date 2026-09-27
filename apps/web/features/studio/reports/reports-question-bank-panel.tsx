import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { ReportProvenanceBadge } from "./report-provenance-badge";
import { ReportsBarChart } from "./reports-bar-chart";
import type { QuestionTypeCount } from "./reports-metrics";

export interface ReportsQuestionBankPanelProps {
  /** What the chart/table below are scoped to — a campaign title, or "All campaigns". */
  scopeLabel: string;
  typeCounts: readonly QuestionTypeCount[];
  locale: SupportedLocale;
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
  locale,
}: ReportsQuestionBankPanelProps) {
  const t = getStudioTranslator(locale);
  const total = typeCounts.reduce((sum, row) => sum + row.count, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle as="h3">{t("reports.questionBank.title")}</CardTitle>
          <CardDescription>{scopeLabel}</CardDescription>
        </div>
        <ReportProvenanceBadge provenance="configured" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {total === 0 ? (
          <p className="text-sm font-sans text-fg-muted">{t("reports.questionBank.empty")}</p>
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
            <DataTable
              caption={t("reports.questionBank.caption", { scopeLabel })}
              rows={[...typeCounts]}
              getRowKey={(row) => row.type}
              columns={[
                {
                  key: "type",
                  header: t("reports.questionBank.typeHeader"),
                  cell: (row) => row.label,
                },
                {
                  key: "count",
                  header: t("reports.questionBank.countHeader"),
                  cell: (row) => row.count,
                },
              ]}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
