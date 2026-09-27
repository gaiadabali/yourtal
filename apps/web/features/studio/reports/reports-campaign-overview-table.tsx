import type { Campaign, CampaignStatus } from "@yourtal/contracts/campaign";
import { Badge } from "@yourtal/ui/badge";
import { DataTable } from "@yourtal/ui/data-table";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { ReportProvenanceBadge } from "./report-provenance-badge";

export interface ReportsCampaignOverviewTableProps {
  campaigns: readonly Campaign[];
  locale: SupportedLocale;
}

const STATUS_VARIANT: Record<CampaignStatus, "success" | "secondary" | "outline"> = {
  active: "success",
  paused: "secondary",
  ended: "outline",
};

const SCORING_RULE_LABEL: Record<Campaign["scoringRule"], string> = {
  base_only: "Base reward only",
  base_plus_accuracy_bonus: "Base + accuracy bonus",
};

/**
 * This business's own campaigns — one real, accessible table (via
 * `@yourtal/ui/data-table`), the text equivalent this whole zone is built
 * around rather than a chart that would need one bolted on separately.
 */
export function ReportsCampaignOverviewTable({
  campaigns,
  locale,
}: ReportsCampaignOverviewTableProps) {
  const t = getStudioTranslator(locale);

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
              <Badge variant={STATUS_VARIANT[campaign.status]}>{campaign.status}</Badge>
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
            cell: (campaign) => SCORING_RULE_LABEL[campaign.scoringRule],
          },
        ]}
      />
      <ReportProvenanceBadge provenance="configured" />
    </div>
  );
}
