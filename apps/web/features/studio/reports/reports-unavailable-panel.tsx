import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { ReportProvenanceBadge } from "./report-provenance-badge";
import type { UnavailableMetric } from "./reports-unavailable-metrics";

export interface ReportsUnavailablePanelProps {
  metric: UnavailableMetric;
  locale: SupportedLocale;
}

/**
 * A named, specific "we can't honestly show this yet" card — not a
 * generic "coming soon" and never a chart with invented numbers. The
 * dashed border is a second, non-colour signal (alongside the badge text)
 * that this panel is structurally different from a real metric panel.
 *
 * The label/reason text itself lives in `studio.json`'s
 * `reports.gaps.<metric.id>` (both locales) — plain business language, no
 * code path, endpoint or ticket ID, per CLAUDE.md's copy rule. This
 * component only supplies the `id` to look it up by.
 */
export function ReportsUnavailablePanel({ metric, locale }: ReportsUnavailablePanelProps) {
  const t = getStudioTranslator(locale);
  return (
    <Card className="border-dashed">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle as="h3">{t(`reports.gaps.${metric.id}.label`)}</CardTitle>
        <ReportProvenanceBadge provenance="unavailable" />
      </CardHeader>
      <CardContent>
        <p className="text-sm font-sans text-fg-muted">{t(`reports.gaps.${metric.id}.reason`)}</p>
      </CardContent>
    </Card>
  );
}
