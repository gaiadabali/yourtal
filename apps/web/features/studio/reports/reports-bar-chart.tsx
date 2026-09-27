export interface ReportsBarChartRow {
  id: string;
  label: string;
  value: number;
  valueLabel: string;
}

export interface ReportsBarChartProps {
  rows: readonly ReportsBarChartRow[];
}

/**
 * Deliberately plain CSS/SVG-free div bars, not visx. docs/15-stack-locked.md
 * locks visx for advertiser reporting charts, but it is not installed in
 * this workspace and this ticket must not run `pnpm install` — see
 * YT-0443's report for the gap this leaves. The prop shape
 * (`rows: {id,label,value,valueLabel}[]`) is the same flat shape a visx
 * `<BarGroup>` would consume, so replacing the rendering here later should
 * not require touching any caller or the aggregation modules
 * (`reports-metrics.ts`) that compute `rows`.
 *
 * `aria-hidden`: this chart is a visual restatement of data that is always
 * rendered as a real `<table>` immediately alongside it (never `alt` text
 * standing in for one) — see `reports-question-bank-panel.tsx` and
 * `reports-redemption-ledger-panel.tsx`. One bar colour throughout, on
 * purpose: each row's category is already carried by its text label and
 * exact value, so colour adds no meaning that would break for a
 * colour-blind viewer if this chart were hidden entirely (WCAG 1.4.1) —
 * which, to a screen reader, it is.
 */
export function ReportsBarChart({ rows }: ReportsBarChartProps) {
  const maxValue = Math.max(1, ...rows.map((row) => row.value));

  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2">
          <span className="w-32 shrink-0 truncate text-xs font-sans text-fg-muted">
            {row.label}
          </span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round((row.value / maxValue) * 100)}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-xs font-sans text-fg">
            {row.valueLabel}
          </span>
        </div>
      ))}
    </div>
  );
}
