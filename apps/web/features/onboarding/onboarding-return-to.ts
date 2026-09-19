/**
 * Optional post-signup redirect target (YT-0432's "returns the user to
 * exactly where they were after signup" — the sign-up prompt Open Viewing
 * shows at the point a rewarded viewer would have been paid links here with
 * `?returnTo=/watch/{campaignId}`). Carried across every onboarding step as
 * a query param rather than stored server-side: onboarding has no session
 * yet to store it against, and the flow's own screens
 * (`app/(app)/onboarding/**`) are a chain of separate routes, not one
 * client-side wizard with shared state.
 *
 * Validated strictly as an internal, same-origin, absolute path. Without
 * this check a `returnTo` value would be an open redirect — this module is
 * the one place every consumer in this feature calls before trusting a
 * value that ultimately came from a URL a user typed or a link an anonymous
 * viewer's own campaign page built.
 */
export function parseReturnTo(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || decoded.includes("://") || decoded.includes("\\")) {
      return null;
    }
  } catch {
    return null;
  }
  return value;
}

/** Appends `returnTo` (already validated by `parseReturnTo`) to an onboarding step's own path, if present. */
export function withReturnTo(path: string, returnTo: string | null): string {
  return returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path;
}
