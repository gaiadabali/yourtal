import type { Region } from "@yourtal/contracts/region";

/**
 * 1.2.f: reads `platform.region_setting` for the API. A port, not a bare
 * function export, for the same reason `BusinessRegionLookup` is one
 * (`apps/api/src/modules/store/persistence/business-region-lookup.ts`) —
 * callers depend on this interface, not on Drizzle or a Postgres pool.
 */
export interface RegionSettingsReader {
  /**
   * The current value for `key` in `region` — the latest approved row whose
   * `effectiveFrom` has passed — or `null` if no such setting exists.
   * Cached for at most 60 seconds (1.2.f), so a just-approved change can
   * take up to a minute to be read back through this path.
   */
  getSetting<T = unknown>(region: Region, key: string): Promise<T | null>;
}

export const REGION_SETTINGS_READER = Symbol("REGION_SETTINGS_READER");
