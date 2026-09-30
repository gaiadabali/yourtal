import type { Region } from "@yourtal/contracts/region";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";

/** Used only if the settings row is missing; the migration seeds the same numbers. */
const FALLBACK_RESERVE_CPM_MINOR: Readonly<Record<Region, number>> = { AU: 100, ID: 5_000 };

/** The region's floor price per 1,000 boosted impressions (`boost_reserve_cpm`). */
export async function reserveCpmFor(
  settings: RegionSettingsReader,
  region: Region,
): Promise<number> {
  const setting = await settings.getSetting<{ cpmMinor?: number }>(region, "boost_reserve_cpm");
  const value = setting?.cpmMinor;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : FALLBACK_RESERVE_CPM_MINOR[region];
}
