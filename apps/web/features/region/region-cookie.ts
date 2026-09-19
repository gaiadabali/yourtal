/**
 * The single definition of the region cookie's name.
 *
 * It was briefly declared twice — once in `get-region.ts` (which reads it)
 * and once in `features/onboarding/onboarding-region-cookie.ts` (which the
 * region-picker Server Action writes). Two string literals that must agree,
 * in different features, owned by different tickets. If they ever drifted,
 * nothing would throw: `getRegion()` would simply never find the cookie and
 * every screen would silently fall back to the default region, so an
 * Australian user would see Rupiah and no test would fail.
 *
 * Deliberately dependency-free — no `next/headers` — so both the server-only
 * reader and the `"use server"` action's sibling module can import it.
 */
export const REGION_COOKIE_NAME = "yourtal-region";
