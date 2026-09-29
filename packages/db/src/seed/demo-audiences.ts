import type pg from "pg";
import { categoryPolicy } from "@yourtal/jurisdiction/content-category";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";
import type { Audience } from "@yourtal/contracts/audience/audience";
import { stableId } from "@yourtal/media/demo-media";

/**
 * TASKS.md Phase 12's check needs "an adult-only campaign is denied to a
 * teen principal on every endpoint", and the done-when needs a teen to see
 * teen and all_ages items and a parent to see `parents` items. Every seeded
 * demo campaign ships `audience: "all_ages"` (`staging.ts`'s four Snap App
 * fixtures, `packages/media/src/demo-media.ts`'s sixteen `ensureCampaign`
 * rows), so staging has nothing non-all_ages to prove the wall with.
 *
 * Re-rates three of the sixteen real demo-media businesses' campaigns per
 * region (8 AU + 8 ID) to teen/adult/parents, by the FIXED slug -> audience
 * table below — never randomly and never by array position, so a manifest
 * reorder can't silently reshuffle which brand is "the adult one". The
 * other five demo-media campaigns per region, plus the two Snap App quick
 * campaigns `staging.ts` seeds per region, stay `all_ages`: logged-out Open
 * Viewing still has teasers.
 *
 * Called from `main-staging.ts` LAST, after `runDemoMedia`,
 * `runDemoCampaignFunding` and `runDemoMediaVouchers`. Not load-bearing for
 * correctness — nothing upstream of it ever rewrites `audience` after a
 * row's first insert: `ensureCampaign`'s own `ON CONFLICT DO UPDATE SET`
 * deliberately leaves `audience` out of its column list, and
 * `ensureOneBusiness` (`demo-media-vouchers.ts`) only calls `insertListing`
 * when no listing exists yet — but running last means this step always
 * sees the final, funded state of every campaign it might re-rate.
 *
 * Idempotent: only issues an UPDATE when a row's `audience` differs from
 * the target, and a business whose campaign/listing hasn't been seeded yet
 * (an earlier step failed or hasn't run) is skipped and logged, never
 * failed — the same "never hold the deploy hostage over cosmetic demo rows"
 * reasoning `runDemoMedia`/`runDemoMediaVouchers` already use.
 */

interface AudiencePick {
  readonly slug: string;
  readonly region: "AU" | "ID";
  readonly audience: Exclude<Audience, "all_ages">;
}

/** Exported so a test (or a future picks review) can walk this table
 * directly rather than re-deriving it from `runDemoAudiences`'s return
 * value. */
export const AUDIENCE_PICKS: readonly AudiencePick[] = [
  // AU: surf boards read as youth/teen; trade power tools read as an adult's
  // own purchase; family hiking/camping gear reads as a parent buying for a
  // trip. The other five AU demo-media brands (coffee, bicycles, tours,
  // bakery, wool) stay all_ages.
  { slug: "au-bondi-board-co", region: "AU", audience: "teen" },
  { slug: "au-perth-power-tools", region: "AU", audience: "adult" },
  { slug: "au-outback-trail-gear", region: "AU", audience: "parents" },
  // ID: boba tea reads as youth/teen; a motor dealer reads as an adult's
  // own purchase; household spice shopping reads as a parent stocking the
  // family kitchen. The other five ID demo-media brands (kopi, batik,
  // snacks, textiles, marine gear) stay all_ages.
  { slug: "id-bandung-boba-bar", region: "ID", audience: "teen" },
  { slug: "id-jakarta-jaya-motor", region: "ID", audience: "adult" },
  { slug: "id-medan-spice-traders", region: "ID", audience: "parents" },
];

export interface DemoAudienceResult {
  readonly slug: string;
  readonly region: "AU" | "ID";
  readonly audience: Audience;
  readonly campaign: "updated" | "already_set" | "not_found";
  readonly listing: "updated" | "already_set" | "not_found";
}

interface CampaignRow {
  readonly audience: string;
  readonly content_category: string;
}

async function reRateCampaign(
  pool: pg.Pool,
  campaignId: string,
  pick: AudiencePick,
): Promise<DemoAudienceResult["campaign"]> {
  const result = await pool.query<CampaignRow>(
    `SELECT audience, content_category FROM campaign.campaigns
      WHERE id = $1 AND lifecycle_state = 'live'
        AND EXISTS (SELECT 1 FROM campaign.reward_config WHERE campaign_id = $1)`,
    [campaignId],
  );
  const row = result.rows[0];
  if (row === undefined) return "not_found";

  if (pick.audience === "teen") {
    const status = categoryPolicy(pick.region, row.content_category as ContentCategory);
    if (status !== "allowed") {
      // A future edit to this picks table (or to CATEGORY_POLICY) must fail
      // the deploy loudly here rather than silently show a teen an
      // adult_only or prohibited brand.
      throw new Error(
        `demo-audiences: refusing to rate ${campaignId} (${pick.slug}) teen — its category ` +
          `"${row.content_category}" is ${status} in ${pick.region}`,
      );
    }
  }

  if (row.audience === pick.audience) return "already_set";
  await pool.query(`UPDATE campaign.campaigns SET audience = $2 WHERE id = $1`, [
    campaignId,
    pick.audience,
  ]);
  return "updated";
}

async function reRateListing(
  pool: pg.Pool,
  businessId: string,
  pick: AudiencePick,
): Promise<DemoAudienceResult["listing"]> {
  const result = await pool.query<{ id: string; audience: string }>(
    `SELECT id, audience FROM store.listings WHERE merchant_id = $1`,
    [businessId],
  );
  const row = result.rows[0];
  if (row === undefined) return "not_found";
  if (row.audience === pick.audience) return "already_set";
  await pool.query(`UPDATE store.listings SET audience = $2 WHERE id = $1`, [
    row.id,
    pick.audience,
  ]);
  return "updated";
}

export async function runDemoAudiences(
  pool: pg.Pool,
  log: (message: string) => void,
): Promise<readonly DemoAudienceResult[]> {
  const results: DemoAudienceResult[] = [];
  for (const pick of AUDIENCE_PICKS) {
    const businessId = stableId(`demo-media:business:${pick.slug}`);
    const campaignId = stableId(`demo-media:campaign:${pick.slug}`);

    const campaign = await reRateCampaign(pool, campaignId, pick);
    const listing = await reRateListing(pool, businessId, pick);

    log(
      `[seed:demo-audiences] ${pick.slug} -> ${pick.audience}: campaign ${campaign}, listing ${listing}`,
    );
    results.push({
      slug: pick.slug,
      region: pick.region,
      audience: pick.audience,
      campaign,
      listing,
    });
  }
  return results;
}
