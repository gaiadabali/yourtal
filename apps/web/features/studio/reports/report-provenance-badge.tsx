import { Badge } from "@yourtal/ui/badge";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import type { ReportProvenance } from "./report-provenance";

export interface ReportProvenanceBadgeProps {
  provenance: ReportProvenance;
  locale: SupportedLocale;
}

/**
 * The label text is the accessible content and differs for every tier, so
 * the colour underneath is decoration, never the only signal (WCAG 1.4.1)
 * — a colour-blind viewer, or a screen reader, gets the same distinction
 * either way.
 */
const PROVENANCE_VARIANT: Record<
  ReportProvenance,
  "success" | "secondary" | "outline" | "warning"
> = {
  measured: "success",
  self_reported: "secondary",
  inferred: "secondary",
  configured: "outline",
  unavailable: "warning",
};

export function ReportProvenanceBadge({ provenance, locale }: ReportProvenanceBadgeProps) {
  const t = getStudioTranslator(locale);
  return (
    <Badge variant={PROVENANCE_VARIANT[provenance]}>
      {t(`reports.provenance.label.${provenance}`)}
    </Badge>
  );
}
