import { Badge } from "@yourtal/ui/badge";
import type { ReportProvenance } from "./report-provenance";
import { PROVENANCE_LABEL } from "./report-provenance";

export interface ReportProvenanceBadgeProps {
  provenance: ReportProvenance;
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

export function ReportProvenanceBadge({ provenance }: ReportProvenanceBadgeProps) {
  return <Badge variant={PROVENANCE_VARIANT[provenance]}>{PROVENANCE_LABEL[provenance]}</Badge>;
}
