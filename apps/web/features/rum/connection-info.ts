/**
 * Reads the Network Information API's `effectiveType` (`"4g"`, `"3g"`,
 * `"2g"`, `"slow-2g"`) for RUM segmentation (YT-0501 AC2). Chromium-only —
 * Safari and Firefox implement no part of this API, so "unknown" is an
 * expected, common bucket, not a bug.
 *
 * Takes the connection object as a parameter rather than reading
 * `navigator.connection` itself, so this stays testable with a plain
 * object and no jsdom network-API shim.
 */
export function readEffectiveConnectionType(
  connection: { effectiveType?: string } | null | undefined,
): string {
  return connection?.effectiveType ?? "unknown";
}
