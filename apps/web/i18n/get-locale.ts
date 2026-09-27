import "server-only";
// See apps/web/features/README-server-only.md: importing this from a
// client graph is a build failure once `server-only` is aliased there.

import { cookies } from "next/headers";
import { displayLocaleSchema, type DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { LOCALE_COOKIE } from "@/lib/api/cookies";
import { getRegion } from "@/features/region/get-region";
import { regionDisplayConfig } from "@/features/region/region-config";

/**
 * The display language (6.1.b, F2) — independent of region: an Australian
 * account can read Indonesian and vice versa, so this is never derived
 * from `yt_region`. Reads `yt_locale` directly; falls back to the
 * region's own default locale only when no explicit choice has ever been
 * written (a cookie-less visit, or one that only ever set a region), and
 * to that region's own default when the region itself is also unknown
 * (`getRegion()`'s own AU fallback, task 0.5).
 *
 * This is the ONE reader every Server Component should use for "what
 * language is this screen in" — `i18n/request.ts` (next-intl's own
 * catalogue loader) and every page that used to destructure `locale` off
 * `getRegionDisplayConfig()` both call this instead.
 */
export async function getDisplayLocale(): Promise<DisplayLocale> {
  const cookieStore = await cookies();
  const parsed = displayLocaleSchema.safeParse(cookieStore.get(LOCALE_COOKIE)?.value);
  if (parsed.success) return parsed.data;
  const region = await getRegion();
  return regionDisplayConfig(region).locale;
}
