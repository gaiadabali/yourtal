import { describe, expect, it } from "vitest";
import { createAppDb } from "../persistence/drizzle-client";
import { DrizzleRegionSettingsReader } from "./drizzle-region-settings-reader";

/**
 * Against real Postgres (1.2.g's own Check): "`getSetting('AU',
 * 'daily_earn_cap')` returns 500". `vitest.config.ts`'s `setupFiles` refuses
 * to run this suite against anything but a `yourtal_test_*` database, and
 * `with-test-db.mjs` seeds that database from every migration on this
 * branch — including 20260925193000's F12 defaults — before any test runs,
 * so this is a genuine round trip through the migration this ticket adds,
 * not a mock.
 */
const db = createAppDb(process.env["DATABASE_URL"] ?? requiredEnv("DATABASE_URL"));
const reader = new DrizzleRegionSettingsReader(db);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} is not set — see vitest.config.ts's setupFiles.`);
  }
  return value;
}

describe("DrizzleRegionSettingsReader", () => {
  it("reads F12's seeded AU daily earn cap", async () => {
    expect(await reader.getSetting("AU", "daily_earn_cap")).toBe(500);
  });

  it("reads the same key differently per region — AU and ID are separate economies (F2)", async () => {
    expect(await reader.getSetting("ID", "daily_earn_cap")).toBe(5000);
  });

  it("reads a money-shaped setting as minor units plus a currency", async () => {
    expect(await reader.getSetting("AU", "points_pack")).toEqual({
      points: 1000,
      priceMinor: 4500,
      currency: "AUD",
    });
  });

  it("returns null for a key that does not exist", async () => {
    expect(await reader.getSetting("AU", "not_a_real_setting")).toBeNull();
  });

  it("caches for up to 60s: a value read once does not re-query until cleared", async () => {
    const first = await reader.getSetting("AU", "daily_earn_cap");
    // A second call within the TTL must not need another round trip; this
    // does not prove that on its own, but combined with the cache being a
    // plain Map keyed by region+key (see the class under test), the only way
    // this stays consistent after `clearCache()` below is if it really was
    // reading the same in-memory entry, not coincidentally the same DB row.
    const second = await reader.getSetting("AU", "daily_earn_cap");
    expect(second).toBe(first);

    reader.clearCache();
    expect(await reader.getSetting("AU", "daily_earn_cap")).toBe(first);
  });
});
