import type { CampaignReportResult } from "@yourtal/contracts/report";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { KeyValue } from "@yourtal/ui/key-value";
import { PointsChip } from "@yourtal/ui/points-chip";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";

export interface ReportsCampaignMetricsPanelProps {
  /** `null`: the API has nothing for this campaign (7.6.a — not this business's own, or not found). `undefined`: no campaign is selected. */
  report: CampaignReportResult | null | undefined;
  locale: SupportedLocale;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function formatSeconds(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}s`;
}

/**
 * The selected campaign's own performance (task 7.6.a / F40's reports
 * wiring) — aggregates only, real numbers from the server, suppressed
 * below the cohort floor rather than shown with a small, identifiable
 * population. Rendered only when a single campaign is picked in
 * `reports-campaign-filter.tsx`; "All campaigns" has no single report to
 * show.
 */
export function ReportsCampaignMetricsPanel({ report, locale }: ReportsCampaignMetricsPanelProps) {
  const t = getStudioTranslator(locale);

  if (report === undefined) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("reports.metrics.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {report === null ? (
          <p className="text-body-sm text-fg-muted">{t("reports.metrics.notFound")}</p>
        ) : report.suppressed ? (
          <p className="text-body-sm text-fg-muted">
            {t("reports.metrics.suppressed", { floor: report.floor })}
          </p>
        ) : (
          <KeyValue
            items={[
              {
                key: "rewardedViews",
                label: t("reports.metrics.rewardedViews"),
                value: report.rewardedViews,
              },
              {
                key: "completions",
                label: t("reports.metrics.completions"),
                value: report.completions,
              },
              {
                key: "completionRate",
                label: t("reports.metrics.completionRate"),
                value: formatPercent(report.completionRate),
              },
              {
                key: "averageWatchTime",
                label: t("reports.metrics.averageWatchTime"),
                value: formatSeconds(report.averageWatchTimeSeconds),
              },
              {
                key: "questionAccuracy",
                label: t("reports.metrics.questionAccuracy"),
                value: formatPercent(report.questionAccuracy),
              },
              {
                key: "pointsSpent",
                label: t("reports.metrics.pointsSpent"),
                value: (
                  <PointsChip
                    value={report.pointsSpent}
                    size="sm"
                    formatLabel={(formatted) =>
                      t("reports.metrics.pointsSpentLabel", { formatted })
                    }
                  />
                ),
              },
              {
                key: "vouchersRedeemed",
                label: t("reports.metrics.vouchersRedeemed"),
                value: report.merchantVouchersRedeemed,
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
