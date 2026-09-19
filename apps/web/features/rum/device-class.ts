export type DeviceClass = "low" | "mid" | "high" | "unknown";

/**
 * A coarse device-class heuristic (YT-0501 AC2: "segmented by ... device
 * class"). `navigator.deviceMemory` and `navigator.hardwareConcurrency`
 * are the only device-capability signals a browser exposes with no
 * permission prompt, and neither is universal: `deviceMemory` is a Chromium
 * extension (absent on Safari and Firefox entirely, by design — it is
 * capped and coarsened even where present, per the Device Memory spec's
 * own privacy section), and `hardwareConcurrency` reports logical cores,
 * not real performance. This is deliberately labelled a HEURISTIC, not a
 * measurement — good enough to bucket a RUM sample for a dashboard filter,
 * not good enough to gate anything. "unknown" is a real, expected bucket
 * on browsers that expose neither signal, not an error state.
 *
 * Pure and given its inputs explicitly (rather than reading `navigator`
 * itself) so it is testable with no browser globals — `rum-reporter.tsx`
 * is the one caller that reads the real `navigator` values.
 */
export function classifyDevice(
  hardwareConcurrency: number | undefined,
  deviceMemoryGb: number | undefined,
): DeviceClass {
  if (hardwareConcurrency === undefined && deviceMemoryGb === undefined) {
    return "unknown";
  }
  // A mid-tier Android in Jakarta (docs/08 §3's actual target device) is
  // commonly a 6-8 logical-core SoC with 4GB RAM — the low/mid/high cuts
  // below bracket that squarely in "mid" rather than "low" or "high", which
  // is the sanity check this heuristic must pass.
  if ((deviceMemoryGb ?? Infinity) <= 2 || (hardwareConcurrency ?? Infinity) <= 4) {
    return "low";
  }
  if ((deviceMemoryGb ?? 0) >= 8 && (hardwareConcurrency ?? 0) >= 8) {
    return "high";
  }
  return "mid";
}
