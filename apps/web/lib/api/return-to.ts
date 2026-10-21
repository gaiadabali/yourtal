/**
 * The one check every `returnTo` goes through before the app redirects to it:
 * it must be a path on this site. A browser drops tabs and newlines from a
 * URL and reads a backslash as a slash, so `/\t/evil.com` or `/\evil.com`
 * would leave the site as `//evil.com`; those characters are refused in the
 * raw value and in its percent-decoded form. What passes is resolved against
 * a fixed base, must stay on it, and only its path, query and fragment are
 * returned, after the same checks again (dot segments can rebuild `//`).
 */
const BASE = "https://return-to.invalid";

// Control characters (C0 and DEL) and backslashes.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

export function internalReturnPath(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || !raw.startsWith("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  for (const form of [raw, decoded]) {
    if (UNSAFE.test(form) || form.startsWith("//") || form.includes("://")) return null;
  }
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  // Dot segments are resolved above, so `/.//evil.com` or `/a/..//evil.com`
  // only become `//evil.com` now: the result is checked as well.
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (UNSAFE.test(path) || path.startsWith("//")) return null;
  return path;
}
