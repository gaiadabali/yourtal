/**
 * Instrumentation for the two timed acceptance criteria in
 * docs/tasks/phase-u-ui.md YT-0430 ("Signup under 60 seconds on a throttled
 * connection, measured" and "Interest picker with images, 15 seconds to
 * complete"). jsdom (Vitest) cannot render real layout or simulate a
 * throttled network, so no test in this repo can produce the actual
 * wall-clock number — see YT-0401's and YT-0412's own honesty notes in
 * that file for the same limitation on other tickets. What this module CAN
 * do, and does, is make the duration measurable by a real browser pass:
 * every mark shows up in Chrome DevTools' Performance panel, and
 * `performance.getEntriesByName("yourtal:signup")` /
 * `"yourtal:interests"` return the measured duration to a Lighthouse/
 * Playwright script once one exists (none is set up in this repo yet).
 *
 * Wrapped in try/catch throughout: a missing or throwing Performance API
 * (older browsers, a locked-down test environment) must never break the
 * onboarding flow itself — timing is an instrumentation nicety, never
 * load-bearing.
 */
export type OnboardingTimingMark =
  "signup-start" | "signup-complete" | "interests-start" | "interests-complete";

function hasPerformanceApi(): boolean {
  return typeof window !== "undefined" && typeof window.performance !== "undefined";
}

/** Records a named point on the Performance timeline. No-ops outside a browser. */
export function recordOnboardingMark(mark: OnboardingTimingMark): void {
  if (!hasPerformanceApi()) {
    return;
  }
  try {
    window.performance.mark(mark);
  } catch {
    // Performance.mark can throw (duplicate name in some engines, disabled
    // API) — never let instrumentation break the flow it is measuring.
  }
}

/**
 * Computes the duration between two previously-recorded marks and logs it
 * for visibility during manual/QA passes (docs/tasks/phase-u-ui.md YT-0451).
 * Returns the duration in milliseconds, or `null` if either mark is missing
 * or the Performance API is unavailable.
 */
export function measureOnboardingDuration(
  label: string,
  startMark: OnboardingTimingMark,
  endMark: OnboardingTimingMark,
): number | null {
  if (!hasPerformanceApi()) {
    return null;
  }
  try {
    const entry = window.performance.measure(label, startMark, endMark);
    if (process.env["NODE_ENV"] !== "production") {
      console.info(`[onboarding-timing] ${label}: ${entry.duration.toFixed(0)}ms`);
    }
    return entry.duration;
  } catch {
    return null;
  }
}
