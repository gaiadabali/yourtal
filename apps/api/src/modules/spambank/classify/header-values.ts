/**
 * A header as JMAP returns it: `header:X:asText` (the last instance) or
 * `header:X:asText:all` (every instance, topmost first). Absent = null/undefined.
 */
export type HeaderInput = string | readonly string[] | null | undefined;

export function headerValues(h: HeaderInput): readonly string[] {
  if (h === null || h === undefined) return [];
  return typeof h === "string" ? [h] : h;
}

/** True when at least one instance has a non-blank value. */
export function hasNonBlankValue(h: HeaderInput): boolean {
  return headerValues(h).some((v) => v.trim() !== "");
}

/**
 * Removes RFC 5322 comments (nested, with quoted-pairs) outside quoted
 * strings; each comment becomes one space. Quoted strings are kept verbatim.
 * Returns null on unbalanced parentheses or an unterminated quoted string,
 * so callers can fail closed instead of guessing.
 */
export function stripComments(value: string): string | null {
  let out = "";
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    if (inQuote) {
      out += ch;
      if (ch === "\\") {
        i++;
        out += value.charAt(i);
      } else if (ch === '"') {
        inQuote = false;
      }
    } else if (depth > 0) {
      if (ch === "\\") i++;
      else if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) out += " ";
      }
    } else if (ch === "(") {
      depth = 1;
    } else if (ch === ")") {
      return null;
    } else {
      if (ch === '"') inQuote = true;
      out += ch;
    }
  }
  return depth === 0 && !inQuote ? out : null;
}

/**
 * The value with comments removed, trimmed and lower-cased (`Precedence`,
 * `Auto-Submitted` style). Null when the comments are malformed.
 */
export function simpleValue(value: string): string | null {
  const stripped = stripComments(value);
  return stripped === null ? null : stripped.trim().toLowerCase();
}

/**
 * True when a `"` appears inside a comment. A quoted envelope sender echoed
 * into a comment is the only way such text gets there, and it is how a `)`
 * or `;` could be smuggled into an Authentication-Results field.
 */
export function hasQuoteInComment(value: string): boolean {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    if (ch === "\\") i++;
    else if (inQuote) inQuote = ch !== '"';
    else if (depth > 0 && ch === '"') return true;
    else if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    else if (ch === '"') inQuote = true;
  }
  return false;
}
