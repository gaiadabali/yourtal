import type { Region } from "@yourtal/contracts/region";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";

/**
 * F12: "60 min per IP per day, one concurrent anonymous session." Seeded in
 * `platform.region_setting` by migration `20260925193000_platform_region_setting.sql`
 * under these exact keys, for both AU and ID — read fresh here rather than
 * hard-coded, same as 4.4.k's earn caps and 9.5.d's staff-editable Open
 * Viewing limits.
 */
const DAILY_MINUTES_PER_IP_KEY = "open_viewing_daily_minutes_per_ip";
const MAX_CONCURRENT_SESSIONS_KEY = "open_viewing_max_concurrent_sessions";

/** Only used if a region somehow has no seeded row — never the normal path. */
const FALLBACK_DAILY_MINUTES = 60;
const FALLBACK_MAX_CONCURRENT = 1;

export interface OpenViewingLimits {
  readonly dailySeconds: number;
  readonly maxConcurrentSessions: number;
}

export async function readOpenViewingLimits(
  settings: RegionSettingsReader,
  region: Region,
): Promise<OpenViewingLimits> {
  const [dailyMinutes, maxConcurrent] = await Promise.all([
    settings.getSetting<number>(region, DAILY_MINUTES_PER_IP_KEY),
    settings.getSetting<number>(region, MAX_CONCURRENT_SESSIONS_KEY),
  ]);
  return {
    dailySeconds: (dailyMinutes ?? FALLBACK_DAILY_MINUTES) * 60,
    maxConcurrentSessions: maxConcurrent ?? FALLBACK_MAX_CONCURRENT,
  };
}
