import type { DeviceClass } from "./device-class";
import { rateAgainstBudget, type BudgetRating, type RumMetricName } from "./rum-budgets";

export interface RumSample {
  metric: RumMetricName;
  /** Milliseconds for LCP/INP, a unitless score for CLS — same units `web-vitals` itself uses. */
  value: number;
  /** Rating against THIS PLATFORM's own budget (rum-budgets.ts / docs/08 §3.1) — not web-vitals' generic Core Web Vitals thresholds, which are looser for LCP. */
  rating: BudgetRating;
  country: "ID" | "AU" | "unknown";
  connectionType: string;
  deviceClass: DeviceClass;
  pathname: string;
  /** RFC 3339 UTC, matching docs/13-engineering-standards.md §5's wire convention even though this never crosses the BFF today — see rum-sink.ts. */
  timestamp: string;
}

export interface RumSampleInput {
  metric: RumMetricName;
  value: number;
  country: "ID" | "AU" | "unknown";
  connectionType: string;
  deviceClass: DeviceClass;
  pathname: string;
  now: Date;
}

/**
 * The pure "compute" step between web-vitals' callback and the sink
 * (docs/13-engineering-standards.md §1: "parse -> compute -> persist/emit
 * -> extract the middle"). Independently testable with plain data, no
 * `PerformanceObserver`, no `navigator`, no React.
 */
export function buildRumSample(input: RumSampleInput): RumSample {
  return {
    metric: input.metric,
    value: input.value,
    rating: rateAgainstBudget(input.metric, input.value),
    country: input.country,
    connectionType: input.connectionType,
    deviceClass: input.deviceClass,
    pathname: input.pathname,
    timestamp: input.now.toISOString(),
  };
}

/** True when a sample breaches the field budget — the per-sample half of AC3 ("alert when p75 ... breaches the budget"). See rum-sink.ts for why this cannot yet compute or alert on a real p75. */
export function isBudgetBreach(sample: RumSample): boolean {
  return sample.rating === "poor";
}
