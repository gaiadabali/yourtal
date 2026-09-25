import type { BrowserContext } from "@playwright/test";
import { REGION_COOKIE_NAME } from "@/features/region/region-cookie";

/** Pins the region cookie, for specs that assert one region's copy rather than test region resolution. */
export async function pinRegionCookie(
  context: BrowserContext,
  region: "AU" | "ID",
  baseURL: string,
): Promise<void> {
  await context.addCookies([{ name: REGION_COOKIE_NAME, value: region, url: baseURL }]);
}
