import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { inArray } from "drizzle-orm";
import type { StudioMediaDb } from "./drizzle-client";
import { createStudioMediaDb } from "./drizzle-client";
import { mediaAssets } from "./schema/media-asset.table";

/**
 * A real Postgres handle for tests, same convention as
 * `business/persistence/business-db.test-helper.ts` (YT-0552) — no
 * in-memory fallback, so a missing grant or constraint fails here.
 */
export function testStudioMediaDb(): StudioMediaDb {
  return createStudioMediaDb(process.env["TEST_DATABASE_URL"] ?? requiredEnv("DATABASE_URL"));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} is not set — see vitest.config.ts's setupFiles.`);
  }
  return value;
}

/**
 * `studio.media_assets` FKs into `business.business_accounts` and
 * `campaign.campaigns` — tables this module does not own (a different
 * session's files in this phase split, TASKS.md 7.2). Rather than import
 * their Drizzle schemas across that boundary, a fixture test creates its
 * own rows with a plain SQL insert against the same test connection
 * (`yourtal_app` already holds INSERT on both, the same role the app itself
 * runs as) — a fixture that fabricates its own tenant is the same shape
 * `voucher-constraints.test.ts` and `watch-session.test.ts` already use for
 * a table their own module does not own either.
 */
export async function createFixtureBusinessAndCampaign(
  databaseUrl: string,
): Promise<{ businessId: string; campaignId: string; cleanup: () => Promise<void> }> {
  const pool = new Pool({ connectionString: databaseUrl });
  const businessId = randomUUID();
  const campaignId = randomUUID();
  const now = new Date();
  const later = new Date(now.getTime() + 86_400_000);

  await pool.query(
    `INSERT INTO business.business_accounts
       (id, legal_name, display_name, roles, is_verified, region, currency, handle,
        tax_id_kind, tax_id_value, address_state, address_postcode)
     VALUES ($1, $2, $3, $4::jsonb, true, 'AU', 'AUD', $5, 'ABN', '00000000000', 'NSW', '2000')`,
    [
      businessId,
      "Test Business Pty Ltd",
      "Test Business",
      JSON.stringify(["advertiser"]),
      `test-biz-${businessId.slice(0, 8)}`,
    ],
  );
  // published_at is NULL here on purpose: campaigns_published_at_iff_live_or_past
  // (20260927160200_campaign_authoring_draft.sql) requires it unset while
  // lifecycle_state is 'draft' — set only once the lifecycle trigger stamps
  // it on a real transition to 'live'.
  await pool.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
        estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state,
        published_at, business_id, region, audience, content_category,
        poster_url, teaser_url, hls_url, aspect, estimated_bytes, starts_at, ends_at)
     VALUES ($1, 'long_form', 'Test Campaign', $2, 'Test Business', 'A test campaign.', 180,
             40, 100, 3, 'base_plus_accuracy_bonus', 'draft',
             NULL, $2, 'AU', 'all_ages', 'food-and-drink',
             '/media/posters/placeholder.jpg', '/media/teasers/placeholder.mp4',
             '/media/hls/placeholder/index.m3u8', '16:9', 40000000, $3, $4)`,
    [campaignId, businessId, now.toISOString(), later.toISOString()],
  );

  return {
    businessId,
    campaignId,
    cleanup: async () => {
      await pool.query("DELETE FROM campaign.campaigns WHERE id = $1", [campaignId]);
      await pool.query("DELETE FROM business.business_accounts WHERE id = $1", [businessId]);
      await pool.end();
    },
  };
}

export async function clearMediaAssets(db: StudioMediaDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(mediaAssets).where(inArray(mediaAssets.id, ids));
}
