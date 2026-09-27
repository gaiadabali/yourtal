import type { BrowserContext } from "@playwright/test";
import { REGION_COOKIE } from "@/lib/api/cookies";

/** Pins the region cookie (`yt_region`), for specs that assert one region's copy rather than test region resolution. */
export async function pinRegionCookie(
  context: BrowserContext,
  region: "AU" | "ID",
  baseURL: string,
): Promise<void> {
  await context.addCookies([{ name: REGION_COOKIE, value: region, url: baseURL }]);
}
