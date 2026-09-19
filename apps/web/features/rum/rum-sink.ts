import { isBudgetBreach, type RumSample } from "./rum-report";

/**
 * Where a RUM sample goes. There is no ingestion endpoint to send it to —
 * checked: `packages/contracts` has no event schema, and
 * docs/tasks/phase-0-value.md's YT-0059 ("event schema and ingestion
 * skeleton") is still `todo`. Backend work to add one is out of this
 * ticket's reach (frontend cannot invent a `packages/contracts` schema or
 * a BFF endpoint — see the ticket report), so this sink is honestly a
 * placeholder: it logs in development so the pipeline is visibly wired
 * end to end, and does nothing in production rather than pretending to
 * deliver samples nobody receives.
 *
 * **What this means for AC2/AC3**: this file computes and shapes the
 * per-sample data (country, connection, device class, budget rating) that
 * a real backend would need to compute p75 and alert on it, but it cannot
 * itself report a p75 or alert anyone — those require samples from many
 * real users aggregated somewhere durable, which requires YT-0059. Once
 * that endpoint exists, only `sendRumSample`'s body changes (to a
 * `navigator.sendBeacon` POST); every caller and every other file in this
 * feature stays exactly as it is — the same "one seam" shape
 * `campaign-data.ts` uses for its mock/live switch.
 *
 * Telemetry must never crash the app it is measuring, so every branch
 * here is fire-and-forget: no throw, no rejected promise a caller could
 * fail to catch.
 */
export function sendRumSample(sample: RumSample): void {
  try {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[rum]", sample.metric, sample.value, sample.rating, {
        country: sample.country,
        connectionType: sample.connectionType,
        deviceClass: sample.deviceClass,
        pathname: sample.pathname,
        breach: isBudgetBreach(sample),
      });
    }
    // Production: intentionally silent. See the doc comment above.
  } catch {
    // Never let telemetry break the page it is measuring.
  }
}
