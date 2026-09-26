import { randomUUID } from "node:crypto";
import type pg from "pg";

/**
 * Watch's own domain: watch sessions, coverage and completions. 1.3.b split
 * `seed.ts` into one file per domain ahead of that content existing, so
 * Phase 5 (watch and earn) has a place to add it without touching `seed.ts`
 * or anyone else's file.
 *
 * There is still nothing to seed for a SESSION — a viewer's own
 * `POST /api/watch/sessions` call creates one, not fixture data. What this
 * DOES seed, now that 5.1-5.3 wire the earning path end to end, is the two
 * things a session needs from OTHER domains' tables in order to ever pay
 * out at all:
 *
 * 1. Every seeded campaign's `durationSeconds` (campaign row AND terms
 *    version) forced to 30, matching the ONE HLS fixture every mock
 *    campaign actually points at (`campaign.mock.ts`'s
 *    `MOCK_HLS_MANIFEST_URL`, the `attention-30s` asset). EW-07: before
 *    this, the server demanded up to 1,800s of coverage against a 30s
 *    video, which no honest viewer could ever produce. `time-remap.ts` used
 *    to paper over the gap on the client; the honest fix is that the
 *    number the server checks against is the length of the thing actually
 *    playing, so that file is deleted (5.1.c).
 * 2. `campaign.reward_config` (7.1's table, unwired until now — see that
 *    migration's own comment) plus a funded `platform.ledger_fake_allocation`
 *    for every campaign that pays a nonzero reward, so `WatchController`'s
 *    allocation hold (5.1.b, 4.4.e) has something real to hold against
 *    instead of starting every session non-earning for want of funding.
 */
export async function seedWatch(pool: pg.Pool): Promise<void> {
  await alignDurationToFixture(pool);
  await seedRewardFunding(pool);
}

const FIXTURE_DURATION_SECONDS = 30;

async function alignDurationToFixture(pool: pg.Pool): Promise<void> {
  await pool.query(
    `UPDATE campaign.campaigns SET duration_seconds = $1 WHERE duration_seconds <> $1`,
    [FIXTURE_DURATION_SECONDS],
  );
  await pool.query(
    `UPDATE campaign.terms_version SET duration_seconds = $1 WHERE duration_seconds <> $1`,
    [FIXTURE_DURATION_SECONDS],
  );
  // `campaignSchema` refines that every chapter starts before the
  // campaign's own `durationSeconds`, and the first chapter at exactly 0
  // (docs/06 §3's back-loaded-weight example, `campaign.mock.ts`'s
  // `mockChapters`). Forcing `duration_seconds` down to 30 without touching
  // `campaign.chapter` left every long_form campaign's LAST chapter
  // starting well past its new duration — the exact refinement this fails,
  // which `DrizzleCampaignRepository.assemble` then drops silently rather
  // than erroring, so `listVisible` quietly returned zero long_form
  // campaigns. Recomputed with the SAME algorithm `mockChapters` uses
  // (`ordinal * floor(duration / chapterCount)`), which is exactly what
  // regenerating chapters for a 30s video produces.
  const chapterCounts = await pool.query<{ campaign_id: string; count: string }>(
    `SELECT campaign_id, count(*) FROM campaign.chapter GROUP BY campaign_id`,
  );
  for (const row of chapterCounts.rows) {
    const count = Number(row.count);
    if (count === 0) continue;
    const chapterSeconds = Math.floor(FIXTURE_DURATION_SECONDS / count);
    await pool.query(
      `UPDATE campaign.chapter SET start_seconds = ordinal * $2 WHERE campaign_id = $1`,
      [row.campaign_id, Math.max(chapterSeconds, 1)],
    );
  }
  // `teaserStartSeconds < durationSeconds` is the other refinement a stale
  // value could now violate.
  await pool.query(
    `UPDATE campaign.campaigns SET teaser_start_seconds = 0 WHERE teaser_start_seconds >= $1`,
    [FIXTURE_DURATION_SECONDS],
  );
}

/** AU/ID's own currency, mirroring `RegionConfig` — kept local rather than importing `@yourtal/contracts` for one pairing. */
function currencyFor(region: string): string {
  return region === "AU" ? "AUD" : "IDR";
}

async function seedRewardFunding(pool: pg.Pool): Promise<void> {
  const payingCampaigns = await pool.query<{
    id: string;
    business_id: string;
    region: string;
    reward_points: number;
  }>(`SELECT id, business_id, region, reward_points FROM campaign.campaigns WHERE reward_points > 0`);

  for (const campaign of payingCampaigns.rows) {
    const existing = await pool.query(
      `SELECT 1 FROM campaign.reward_config WHERE campaign_id = $1`,
      [campaign.id],
    );
    if ((existing.rowCount ?? 0) > 0) continue;

    const allocationId = randomUUID();
    // Lavishly funded — this is fixture data for exercising the earning
    // path in dev and tests, not a real partner's budget. 4.4.a-b's
    // exhaustion behaviour is proved against the ledger's own tests, not
    // by starving a seeded allocation here.
    const totalPoints = Math.max(campaign.reward_points * 1_000, 100_000);
    await pool.query(
      `INSERT INTO platform.ledger_fake_allocation
         (id, business_id, region, funder_type, currency, total_points, remaining_points)
       VALUES ($1, $2, $3, 'partner', $4, $5, $5)`,
      [allocationId, campaign.business_id, campaign.region, currencyFor(campaign.region), totalPoints],
    );
    await pool.query(
      `INSERT INTO campaign.reward_config
         (campaign_id, allocation_id, funder_type, max_points_for_campaign,
          reward_points_per_completion, accuracy_bonus_points)
       VALUES ($1, $2, 'partner', $3, $3, 0)
       ON CONFLICT (campaign_id) DO NOTHING`,
      [campaign.id, allocationId, campaign.reward_points],
    );
  }
}
