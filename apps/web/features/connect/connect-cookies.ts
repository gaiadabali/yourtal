/**
 * The only cookies the interaction API needs from the browser: the
 * provider's, set with path `/connect/<uid>`. Forwarded exactly as the
 * browser sent them (no decode and re-encode), because the signature is
 * checked over the raw value.
 */
const INTERACTION_COOKIE_NAMES: ReadonlySet<string> = new Set(["_interaction", "_interaction.sig"]);

/** `null` when the request carried neither. Nothing else from the browser's `Cookie` header is passed on. */
export function interactionCookieHeader(rawCookieHeader: string | null): string | null {
  if (rawCookieHeader === null) return null;
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of rawCookieHeader.split(";")) {
    const segment = part.trim();
    const separator = segment.indexOf("=");
    if (separator === -1) continue;
    const name = segment.slice(0, separator);
    if (!INTERACTION_COOKIE_NAMES.has(name) || seen.has(name)) continue;
    seen.add(name);
    kept.push(segment);
  }
  return kept.length > 0 ? kept.join("; ") : null;
}
