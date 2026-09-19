import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@yourtal/ui/card";
import {
  PROVENANCE_EXPLANATION,
  PROVENANCE_LABEL,
  REPORT_PROVENANCE_LEVELS,
} from "./report-provenance";

/**
 * The unskippable banner docs/23-critique.md §1.0 requires before this
 * screen shows a single attention metric — placed first in `reports-screen.tsx`,
 * above every panel, not folded into a tooltip a viewer can miss.
 */
export function ReportsProvenanceLegend() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">How to read these numbers</CardTitle>
        <CardDescription>
          This platform cannot currently prove a view was watched by a person rather than a device
          farm — Cloudflare Stream exposes no per-session or per-segment data, and Wake Lock,
          phone-verified identity and passkeys are each defeated for cents per account
          (docs/23-critique.md §1.0). There is no &ldquo;verified&rdquo; tier below, on purpose:
          that would be a fabrication. Every number on this page carries one of these labels
          instead, and any metric this business asks for that none of them can honestly support is
          shown as a named gap further down, not a guess.
        </CardDescription>
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
