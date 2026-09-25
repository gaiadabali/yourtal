import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../persistence/drizzle-client";
import { regionSettings } from "./region-setting.table";
import type { RegionSettingsReader } from "./region-settings-reader";

/** 1.2.f: "cached for at most 60 s". */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  readonly value: unknown;
  readonly expiresAt: number;
}

/**
 * Reads `platform.region_setting` for `getSetting(region, key)`
 * (`region_setting_current_idx`, migration 20260925193000, is exactly this
 * query's access path: approved rows only, latest `effectiveFrom` first).
 *
 * A small in-process cache, not Redis: this table changes only through a
 * staff two-person approval (rare, human-paced), every API process already
 * re-reads it within 60 s of a change either way, and a settings read is on
 * the hot path of far more requests (every campaign reward calculation,
 * every earn-cap check) than it is worth a network round trip to Valkey for.
 * `clearCache` exists purely so a test can prove the boundary rather than
 * wait a minute for it.
 */
export class DrizzleRegionSettingsReader implements RegionSettingsReader {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly db: AppDb) {}

  async getSetting<T = unknown>(region: Region, key: string): Promise<T | null> {
    const cacheKey = `${region}:${key}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (cached !== undefined && cached.expiresAt > now) {
      return cached.value as T | null;
    }

    const [row] = await this.db
      .select({ value: regionSettings.value })
      .from(regionSettings)
      .where(
        and(
          eq(regionSettings.region, region),
          eq(regionSettings.key, key),
          isNotNull(regionSettings.approvedBy),
          lte(regionSettings.effectiveFrom, sql`now()`),
        ),
      )
      .orderBy(desc(regionSettings.effectiveFrom))
      .limit(1);

    const value = (row?.value ?? null) as T | null;
    this.cache.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  }

  /** Test-only escape hatch — see the class comment. */
  clearCache(): void {
    this.cache.clear();
  }
}
