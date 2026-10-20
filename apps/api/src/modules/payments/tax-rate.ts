import type { Region } from "@yourtal/contracts/region";
import type { RegionSettingsReader } from "../../shared/settings/region-settings-reader";

/** Used only if the settings row is missing; the migration seeds the same numbers (F118). */
const FALLBACK_GST_RATE_BPS: Readonly<Record<Region, number>> = { AU: 1_000, ID: 0 };

/** The region's GST rate in basis points (`gst_rate_bps`, an F12-style setting). */
export async function gstRateBpsFor(
  settings: RegionSettingsReader,
  region: Region,
): Promise<number> {
  const setting = await settings.getSetting<{ rateBps?: unknown }>(region, "gst_rate_bps");
  const value = setting?.rateBps;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000
    ? value
    : FALLBACK_GST_RATE_BPS[region];
}
