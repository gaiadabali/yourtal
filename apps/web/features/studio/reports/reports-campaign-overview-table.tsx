import type { CampaignStatus } from "@yourtal/contracts/campaign";
import type { CampaignReportResult } from "@yourtal/contracts/report";
import { Badge } from "@yourtal/ui/badge";
import { DataTable } from "@yourtal/ui/data-table";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { ReportProvenanceBadge } from "./report-provenance-badge";
import type { ReportsCampaign } from "./reports-campaign";

export interface ReportsCampaignOverviewTableProps {
  campaigns: readonly ReportsCampaign[];
  /**
   * Each campaign's own report by campaign id (7.6.a), when they were fetched: `null` is a
   * campaign the API has no report for. Left out, the table shows configuration only.
   */
  reports?: Readonly<Record<string, CampaignReportResult | null>> | undefined;
  locale: SupportedLocale;
}

const STATUS_VARIANT: Record<CampaignStatus, "success" | "secondary" | "outline"> = {
  active: "success",
  paused: "secondary",
  ended: "outline",
};

/**
 * This business's own campaigns — one real, accessible table (via
 * `@yourtal/ui/data-table`), the text equivalent this whole zone is built
 * around rather than a chart that would need one bolted on separately.
 */
export function ReportsCampaignOverviewTable({
  campaigns,
  reports,
  locale,
}: ReportsCampaignOverviewTableProps) {
  const t = getStudioTranslator(locale);
  const numbers = new Intl.NumberFormat(locale);

  /** A figure from the campaign's report; below the F12 floor every figure is withheld together, so say so instead of a dash that could read as zero. */
  function figure(
    campaign: ReportsCampaign,
    pick: (report: Extract<CampaignReportResult, { suppressed: false }>) => number,
  ): string {
    const report = reports?.[campaign.id];
    if (report === undefined || report === null) return "—";
    return report.suppressed
      ? t("reports.overview.fewViewers", { floor: report.floor })
      : numbers.format(pick(report));
  }

  if (campaigns.length === 0) {
    return <p className="text-sm font-sans text-fg-muted">{t("reports.overview.empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <DataTable
        caption={t("reports.overview.caption")}
        rows={[...campaigns]}
        getRowKey={(campaign) => campaign.id}
        columns={[
          {
            key: "title",
            header: t("reports.overview.campaignHeader"),
            cell: (campaign) => campaign.title,
          },
          {
            key: "status",
            header: t("reports.overview.statusHeader"),
            cell: (campaign) => (
              <Badge variant={STATUS_VARIANT[campaign.status]}>
                {t(`reports.overview.status.${campaign.status}`)}
              </Badge>
            ),
          },
          {
            key: "questions",
            header: t("reports.overview.questionsHeader"),
            cell: (campaign) => campaign.questionCount,
          },
          {
            key: "scoringRule",
            header: t("reports.overview.scoringRuleHeader"),
            cell: (campaign) =>
              campaign.scoringRule
                ? t(`reports.overview.scoringRule.${campaign.scoringRule}`)
                : t("reports.overview.scoringRuleNotSet"),
          },
          ...(reports === undefined
            ? []
            : [
                {
                  key: "views",
                  header: t("reports.overview.viewsHeader"),
                  cell: (campaign: ReportsCampaign) => figure(campaign, (r) => r.rewardedViews),
                },
                {
                  key: "completions",
                  header: t("reports.overview.completionsHeader"),
                  cell: (campaign: ReportsCampaign) => figure(campaign, (r) => r.completions),
                },
                {
                  key: "spend",
                  header: t("reports.overview.spendHeader"),
                  cell: (campaign: ReportsCampaign) =>
                    figure(campaign, (r) => Number(r.pointsSpent)),
                },
              ]),
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <ReportProvenanceBadge provenance="configured" locale={locale} />
        {reports === undefined ? null : (
          <ReportProvenanceBadge provenance="measured" locale={locale} />
        )}
      </div>
    </div>
  );
}
