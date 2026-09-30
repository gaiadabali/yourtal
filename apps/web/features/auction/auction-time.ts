/** "2 d 3 h", "45 min", or "under a minute", from the server's clock at render. */
export function timeLeftParts(
  endsAtIso: string,
  nowMs: number,
): { key: string; values: Record<string, number> } {
  const ms = Date.parse(endsAtIso) - nowMs;
  if (ms <= 0) return { key: "ended", values: {} };
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return { key: "underMinute", values: {} };
  if (minutes < 60) return { key: "minutes", values: { m: minutes } };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "hours", values: { h: hours, m: minutes % 60 } };
  return { key: "days", values: { d: Math.floor(hours / 24), h: hours % 24 } };
}
