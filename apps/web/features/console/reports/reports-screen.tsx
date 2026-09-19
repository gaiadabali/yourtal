import type { BusinessRole } from "@yourtal/contracts/business";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import type { ReportsBundle } from "./reports-data";
import {
  aggregateQuestionTypeCounts,
  summarizeQuestionBank,
  summarizeRedemptionLedger,
} from "./reports-metrics";
import { ReportsCampaignFilter } from "./reports-campaign-filter";
import { ReportsCampaignOverviewTable } from "./reports-campaign-overview-table";
import { ReportsProvenanceLegend } from "./reports-provenance-legend";
import { ReportsQuestionBankPanel } from "./reports-question-bank-panel";
import { ReportsRedemptionLedgerPanel } from "./reports-redemption-ledger-panel";
import { ReportsUnavailablePanel } from "./reports-unavailable-panel";
import { UNAVAILABLE_METRICS } from "./reports-unavailable-metrics";

type SupportedCurrency = "AUD" | "IDR";

export interface ReportsScreenProps {
  /** Already fetched by `page.tsx` — this component does no data access of its own, matching how `TeamScreen` receives `initialRoster` rather than fetching it, and keeping this component plain-`render()`-testable. */
  bundle: ReportsBundle;
  relationships: readonly BusinessRole[];
  /** `undefined` reads as "All campaigns" — see `reports-campaign-filter.tsx`. */
  selectedCampaignId: string | undefined;
  /** `""` or `"?business=<id>"`, threaded through to the campaign filter so it never drops the business switcher's selection. */
  businessQuery: string;
  /** From the viewer's own region (`getRegionDisplayConfig()` in `page.tsx`), never hardcoded — see `reports-redemption-ledger-panel.tsx` for the one known gap this still carries. */
  currency: SupportedCurrency;
}

/**
 * The Reports zone's whole tree (YT-0443). A Server Component end to end —
 * `reports-campaign-filter.tsx` is links, not client state, so nothing
 * here needs `"use client"` at all (docs/13b-typescript-standards.md §8).
 *
 * Structural guarantee for the brief's "aggregates only; no interface path
 * to a per-user answer exists": nothing in this subtree accepts, stores or
 * links to a user id. Every prop and every fetched record here is scoped
 * to a business (campaigns, listings, vouchers) or is a business-set
 * configuration (question banks) — there is no per-viewer record anywhere
 * in `packages/contracts` this zone could have drilled into even if it
 * tried. `reports-screen.test.tsx` asserts this by searching the rendered
 * tree for anything shaped like a user id and finding none.
 *
 * Structural guarantee for "open views and rewarded views ... never
 * combinable": both are listed as two SEPARATE `UNAVAILABLE_METRICS`
 * entries (`reports-unavailable-metrics.ts`), never as fields on one
 * shared type, so there is no total anywhere that could sum them — the
 * separation holds even though neither number exists yet.
 */
export function ReportsScreen({
  bundle,
  relationships,
  selectedCampaignId,
  businessQuery,
  currency,
}: ReportsScreenProps) {
  const isAdvertiser = relationships.includes("advertiser");
  const isSupplier = relationships.includes("supplier");

  const questionBankRows = summarizeQuestionBank(bundle.campaigns, bundle.questionsByCampaignId);
  const selectedCampaign = bundle.campaigns.find((campaign) => campaign.id === selectedCampaignId);
  const selectedRow = selectedCampaign
    ? questionBankRows.find((row) => row.campaignId === selectedCampaign.id)
    : undefined;
  const scopeLabel = selectedCampaign?.title ?? "All campaigns";
  const typeCounts = selectedRow
    ? selectedRow.typeCounts
    : aggregateQuestionTypeCounts(questionBankRows);

  const redemptionSummary = summarizeRedemptionLedger(bundle.vouchers);

  const relevantGaps = UNAVAILABLE_METRICS.filter(
    (metric) =>
      metric.requiresRelationship === null || relationships.includes(metric.requiresRelationship),
  );

  return (
    <div className="flex flex-col gap-6">
      <ReportsProvenanceLegend />

      {isAdvertiser ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Campaigns</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ReportsCampaignOverviewTable campaigns={bundle.campaigns} />
            {bundle.campaigns.length > 0 ? (
              <ReportsCampaignFilter
                options={bundle.campaigns.map((campaign) => ({
                  id: campaign.id,
                  label: campaign.title,
                }))}
                selectedCampaignId={selectedCampaign?.id}
                businessQuery={businessQuery}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {isAdvertiser ? (
        <ReportsQuestionBankPanel scopeLabel={scopeLabel} typeCounts={typeCounts} />
      ) : null}

      {isSupplier ? (
        <ReportsRedemptionLedgerPanel summary={redemptionSummary} currency={currency} />
      ) : null}

      {!isAdvertiser && !isSupplier ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Nothing to report yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-sans text-fg-muted">
              This business holds no advertiser or supplier relationship, so it has no campaigns or
              listings for this zone to summarise. A redeemer-only business&rsquo;s own redemption
              log lives in the Redemption zone, not here.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {relevantGaps.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-sans font-semibold text-fg">
            What this report cannot show yet
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {relevantGaps.map((metric) => (
              <ReportsUnavailablePanel key={metric.id} metric={metric} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
