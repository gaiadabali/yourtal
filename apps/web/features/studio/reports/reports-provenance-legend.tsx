import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@yourtal/ui/card";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import {
  PROVENANCE_EXPLANATION,
  PROVENANCE_LABEL,
  REPORT_PROVENANCE_LEVELS,
} from "./report-provenance";

export interface ReportsProvenanceLegendProps {
  locale: SupportedLocale;
}

/**
 * An unskippable banner before this screen shows a single attention
 * metric — placed first in `reports-screen.tsx`, above every panel, not
 * folded into a tooltip a viewer can miss (red line 5: no promises this
 * platform cannot back up).
 */
export function ReportsProvenanceLegend({ locale }: ReportsProvenanceLegendProps) {
  const t = getStudioTranslator(locale);
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("reports.legend.title")}</CardTitle>
        <CardDescription>{t("reports.legend.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {REPORT_PROVENANCE_LEVELS.map((level) => (
            <div key={level} className="flex flex-col gap-1">
              <dt className="text-sm font-sans font-semibold text-fg">{PROVENANCE_LABEL[level]}</dt>
              <dd className="text-sm font-sans text-fg-muted">{PROVENANCE_EXPLANATION[level]}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
