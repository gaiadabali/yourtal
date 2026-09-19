import type { Campaign, CampaignStatus } from "@yourtal/contracts/campaign";
import { Badge } from "@yourtal/ui/badge";
import { ReportProvenanceBadge } from "./report-provenance-badge";

export interface ReportsCampaignOverviewTableProps {
  campaigns: readonly Campaign[];
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
 * This business's own campaigns — one real, accessible `<table>`, the
 * text equivalent this whole zone is built around rather than a chart
 * that would need one bolted on separately.
 */
export function ReportsCampaignOverviewTable({ campaigns }: ReportsCampaignOverviewTableProps) {
  if (campaigns.length === 0) {
    return <p className="text-sm font-sans text-fg-muted">This business has no campaigns yet.</p>;
  }

  return (
    <table className="w-full border-collapse text-left text-sm font-sans">
      <caption className="sr-only">This business&rsquo;s campaigns, as configured</caption>
      <thead>
        <tr className="border-b border-border text-xs uppercase tracking-wide text-fg-muted">
          <th scope="col" className="py-2 pr-3 font-medium">
            Campaign
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Status
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Questions
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Scoring rule
          </th>
        </tr>
      </thead>
      <tbody>
        {campaigns.map((campaign) => (
          <tr key={campaign.id} className="border-b border-border last:border-0">
            <th scope="row" className="py-2 pr-3 font-normal text-fg">
              {campaign.title}
            </th>
            <td className="py-2 pr-3">
              <Badge variant={STATUS_VARIANT[campaign.status]}>{campaign.status}</Badge>
            </td>
            <td className="py-2 pr-3 text-fg">{campaign.questionCount}</td>
            <td className="py-2 pr-3 text-fg">{SCORING_RULE_LABEL[campaign.scoringRule]}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4} className="pt-2">
            <ReportProvenanceBadge provenance="configured" />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
