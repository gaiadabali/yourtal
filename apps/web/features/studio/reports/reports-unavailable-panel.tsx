import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { ReportProvenanceBadge } from "./report-provenance-badge";
import type { UnavailableMetric } from "./reports-unavailable-metrics";

export interface ReportsUnavailablePanelProps {
  metric: UnavailableMetric;
}

/**
 * A named, specific "we can't honestly show this yet" card — not a
 * generic "coming soon" and never a chart with invented numbers. The
 * dashed border is a second, non-colour signal (alongside the badge text)
 * that this panel is structurally different from a real metric panel.
 */
export function ReportsUnavailablePanel({ metric }: ReportsUnavailablePanelProps) {
  return (
    <Card className="border-dashed">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle as="h3">{metric.label}</CardTitle>
        <ReportProvenanceBadge provenance="unavailable" />
      </CardHeader>
      <CardContent>
        <p className="text-sm font-sans text-fg-muted">{metric.reason}</p>
      </CardContent>
    </Card>
  );
}
