/**
 * Field performance budgets (YT-0501), taken verbatim from
 * docs/08-web-app-and-performance.md §3.1 — this is the ONE place that
 * table's three field-measured rows are encoded, so a future budget change
 * happens here, not by hand in a dashboard query.
 *
 * These are field budgets, not the lab ones in `lighthouserc.cjs` — INP has
 * no lab number at all (Lighthouse cannot produce a real interaction), and
 * LCP/CLS are measured in both places for different reasons: lab catches a
 * regression before merge, field proves what actually happened to real
 * users on real networks and real mid-tier Android hardware, which is the
 * number that matters per docs/08 §3.
 */
export type RumMetricName = "LCP" | "INP" | "CLS";

export interface MetricBudget {
  /** Meets budget at or below this value. */
  goodMax: number;
  /** Above this value is a hard fail, per docs/08 §3.1's "hard fail at 2.5s" for LCP; INP/CLS have no separate hard-fail figure documented, so it mirrors the budget itself. */
  poorMin: number;
}

export const RUM_BUDGETS: Record<RumMetricName, MetricBudget> = {
  LCP: { goodMax: 2000, poorMin: 2500 },
  INP: { goodMax: 200, poorMin: 200 },
  CLS: { goodMax: 0.1, poorMin: 0.1 },
};

export type BudgetRating = "good" | "needs-improvement" | "poor";

/** Where a single sample falls against the field budget — independent of `web-vitals`' own rating, which uses Google's general CWV thresholds rather than this platform's own (stricter, in LCP's case) budget. */
export function rateAgainstBudget(metric: RumMetricName, value: number): BudgetRating {
  const budget = RUM_BUDGETS[metric];
  if (value <= budget.goodMax) {
    return "good";
  }
  if (value >= budget.poorMin) {
    return "poor";
  }
  return "needs-improvement";
}
