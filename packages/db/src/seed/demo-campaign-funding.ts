import type pg from "pg";
import {
  exceedsAccuracyBonusRatio,
  exceedsRewardCeiling,
} from "@yourtal/contracts/campaign/reward-config";
import {
  allocationSchema,
  purchasePointsRequestSchema,
} from "@yourtal/contracts/ledger-internal/funding";
import { toPoints } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
import { postSigned } from "./staging";
import type { StagingLedgerConfig } from "./staging";

/**
 * TASKS.md 11.4.h — every campaign the staging seed creates (the 4 Snap App
 * fixtures in `staging.ts` plus the 16 demo-media businesses' campaigns
 * `runDemoMedia` inserts) needs a `campaign.reward_config` row before
 * `fetchFundedCampaigns` (apps/api/src/modules/feed/candidates.ts) will ever
 * return it: no config, no allocation lookup, absent from the feed. Today
 * NOTHING funds them, so the feed is empty on staging and locally.
 *
 * Called from `main-staging.ts` AFTER both `seedStaging` and `runDemoMedia`
 * have run, not from inside `seedStaging` itself — the 16 demo-media
 * campaigns do not exist yet at the point `seedStaging` returns (`runDemoMedia`
 * is the next step in `main()`), so funding them from inside `seedStaging`
 * would silently skip all 16. This file instead re-queries
 * `campaign.campaigns` for whatever is unfunded right now, which works
 * regardless of which earlier step created the row and needs no import from
 * `packages/media` (Area C's, not touched here).
 *
 * One real ledger allocation PER CAMPAIGN (`/v1/allocations/purchase`,
 * never a raw `ledger.allocation` INSERT — same rule `ensureTierZeroPendingGrant`
 * and the demo voucher path already follow), with a fixed idempotency key so
 * a repeat call on an already-funded campaign never happens: the query below
 * only selects campaigns with NO `reward_config` row yet, so a second deploy
 * finds nothing left to do and makes zero ledger calls.
 *
 * Reward math reads the SAME approved `platform.region_setting` rows
 * `set-reward-config.use-case.ts`'s `getSettings` reads (F12:
 * `demo_reward_points_per_minute`, `demo_accuracy_bonus`,
 * `reward_ceiling_points_per_minute`) rather than hard-coding 5/80/25/40 a
 * second time, so a future change to those settings is picked up here too.
 */

const TARGET_COMPLETIONS = 1000;

/** AU 1,000 pts = AUD 45.00 (4500 minor); ID 1,000 pts = IDR 9,000 (minor
 * units at IDR's own exponent 0, so 9000 IS the whole-Rupiah amount) —
 * CLAUDE.md's points-pack rule, same rates `seed/ledger.ts`'s own marketing
 * funding uses. */
const PACK_MINOR_PER_THOUSAND_POINTS: Readonly<Record<Region, number>> = { AU: 4500, ID: 9000 };
const CURRENCY_BY_REGION: Readonly<Record<Region, "AUD" | "IDR">> = { AU: "AUD", ID: "IDR" };

interface RegionEconomy {
  readonly demoRatePerMinute: number;
  readonly accuracyBonusPct: number;
  readonly maxAccuracyBonusOfBasePct: number;
  readonly ceilingPerMinute: number;
}

type SettingRow = { readonly key: string; readonly value: unknown };

async function regionEconomy(pool: pg.Pool, region: Region): Promise<RegionEconomy> {
  const rows = await pool.query<SettingRow>(
    `SELECT DISTINCT ON (key) key, value
       FROM platform.region_setting
      WHERE region = $1 AND approved_by IS NOT NULL AND effective_from <= now()
        AND key IN ('demo_reward_points_per_minute', 'demo_accuracy_bonus', 'reward_ceiling_points_per_minute')
      ORDER BY key, effective_from DESC`,
    [region],
  );
  const byKey = new Map(rows.rows.map((row) => [row.key, row.value]));

  const rate = byKey.get("demo_reward_points_per_minute");
  const bonus = byKey.get("demo_accuracy_bonus") as
    { pct?: unknown; maxOfBasePct?: unknown } | undefined;
  const ceiling = byKey.get("reward_ceiling_points_per_minute");
  if (
    typeof rate !== "number" ||
    typeof bonus?.pct !== "number" ||
    typeof bonus.maxOfBasePct !== "number" ||
    typeof ceiling !== "number"
  ) {
    throw new Error(
      `demo-campaign-funding: region ${region} is missing one of demo_reward_points_per_minute/` +
        `demo_accuracy_bonus/reward_ceiling_points_per_minute in platform.region_setting`,
    );
  }
  return {
    demoRatePerMinute: rate,
    accuracyBonusPct: bonus.pct,
    maxAccuracyBonusOfBasePct: bonus.maxOfBasePct,
    ceilingPerMinute: ceiling,
  };
}

interface UnfundedCampaignRow {
  readonly id: string;
  readonly business_id: string;
  readonly region: string;
  readonly duration_seconds: number;
  readonly question_count: number | null;
  readonly title: string;
}

async function unfundedCampaigns(pool: pg.Pool): Promise<UnfundedCampaignRow[]> {
  const result = await pool.query<UnfundedCampaignRow>(
    `SELECT c.id, c.business_id, c.region, c.duration_seconds, c.question_count, c.title
       FROM campaign.campaigns c
       LEFT JOIN campaign.reward_config rc ON rc.campaign_id = c.id
      WHERE c.lifecycle_state = 'live' AND rc.campaign_id IS NULL
      ORDER BY c.id`,
  );
  return result.rows;
}

/** Base + bonus, clamped so neither F14 (the per-minute ceiling) nor the
 * 40%-of-base accuracy-bonus rule is ever violated — the two REFUSALS
 * `set-reward-config.use-case.ts` enforces for a business's own campaigns,
 * enforced here instead of refusing, since a demo campaign that would
 * violate them still needs SOME funding to appear in the feed. */
function rewardShapeFor(
  durationSeconds: number,
  economy: RegionEconomy,
): { rewardPointsPerCompletion: number; accuracyBonusPoints: number } {
  const minutes = durationSeconds / 60;
  const rewardPointsPerCompletion = Math.max(1, Math.round(economy.demoRatePerMinute * minutes));

  let accuracyBonusPoints = Math.round(
    rewardPointsPerCompletion * (economy.accuracyBonusPct / 100),
  );
  const maxBonusByRatio = Math.floor(
    rewardPointsPerCompletion * (economy.maxAccuracyBonusOfBasePct / 100),
  );
  accuracyBonusPoints = Math.min(accuracyBonusPoints, maxBonusByRatio);
  if (
    exceedsAccuracyBonusRatio({
      rewardPointsPerCompletion: toPoints(rewardPointsPerCompletion),
      accuracyBonusPoints: toPoints(accuracyBonusPoints),
    })
  ) {
    accuracyBonusPoints = maxBonusByRatio;
  }

  if (
    exceedsRewardCeiling(
      {
        rewardPointsPerCompletion: toPoints(rewardPointsPerCompletion),
        accuracyBonusPoints: toPoints(accuracyBonusPoints),
      },
      durationSeconds,
      economy.ceilingPerMinute,
    )
  ) {
    // Base rate itself is over ceiling (an unusually long demo campaign) —
    // drop the bonus first, then cap the base, rather than ship a config
    // `set-reward-config.use-case.ts` would have refused outright.
    accuracyBonusPoints = 0;
    const ceilingPoints = Math.floor(economy.ceilingPerMinute * minutes);
    if (rewardPointsPerCompletion > ceilingPoints) {
      return { rewardPointsPerCompletion: Math.max(1, ceilingPoints), accuracyBonusPoints: 0 };
    }
  }
  return { rewardPointsPerCompletion, accuracyBonusPoints };
}

export interface DemoCampaignFundingResult {
  readonly campaignId: string;
  readonly title: string;
  readonly region: Region;
  readonly status: "funded" | "failed";
  readonly detail?: string;
}

/**
 * Idempotent per campaign: only campaigns with no `campaign.reward_config`
 * row are considered, so a repeat run (every deploy) makes no ledger calls
 * at all once every demo campaign has been funded once.
 */
export async function runDemoCampaignFunding(
  pool: pg.Pool,
  ledger: StagingLedgerConfig,
  log: (message: string) => void,
): Promise<readonly DemoCampaignFundingResult[]> {
  const campaigns = await unfundedCampaigns(pool);
  if (campaigns.length === 0) return [];

  const economyByRegion = new Map<Region, RegionEconomy>();
  for (const region of ["AU", "ID"] as const) {
    economyByRegion.set(region, await regionEconomy(pool, region));
  }

  const results: DemoCampaignFundingResult[] = [];
  for (const campaign of campaigns) {
    const region = campaign.region as Region;
    const economy = economyByRegion.get(region);
    if (economy === undefined) {
      results.push({
        campaignId: campaign.id,
        title: campaign.title,
        region,
        status: "failed",
        detail: `unknown region ${campaign.region}`,
      });
      continue;
    }

    const shape = rewardShapeFor(campaign.duration_seconds, economy);
    const rewardPointsPerCompletion = shape.rewardPointsPerCompletion;
    // No questions, no accuracy to reward: holding a bonus nobody can earn wastes funding.
    const accuracyBonusPoints = (campaign.question_count ?? 0) > 0 ? shape.accuracyBonusPoints : 0;
    const perViewer = rewardPointsPerCompletion + accuracyBonusPoints;
    // A multiple of 1,000 by construction (perViewer * 1,000), CLAUDE.md's
    // points-pack rule ("multiples of 1,000") without a second rounding step.
    const points = perViewer * TARGET_COMPLETIONS;
    const currency = CURRENCY_BY_REGION[region];
    const paidMinor = perViewer * PACK_MINOR_PER_THOUSAND_POINTS[region];

    const request = purchasePointsRequestSchema.parse({
      businessId: campaign.business_id,
      region,
      currency,
      points,
      paidMinor,
      idempotencyKey: `demo-campaign-funding:${campaign.id}`,
    });

    const purchased = await postSigned(ledger, "/v1/allocations/purchase", request);
    if (!purchased.ok) {
      results.push({
        campaignId: campaign.id,
        title: campaign.title,
        region,
        status: "failed",
        detail: purchased.detail,
      });
      continue;
    }
    const allocation = allocationSchema.parse(purchased.body);

    await pool.query(
      `INSERT INTO campaign.reward_config
         (campaign_id, allocation_id, funder_type, max_points_for_campaign,
          reward_points_per_completion, accuracy_bonus_points)
       VALUES ($1, $2, 'partner', $3, $4, $5)
       ON CONFLICT (campaign_id) DO NOTHING`,
      [
        campaign.id,
        allocation.allocationId,
        points,
        rewardPointsPerCompletion,
        accuracyBonusPoints,
      ],
    );

    log(
      `[seed:demo-campaign-funding] funded ${campaign.title} (${campaign.id}, ${region}): ` +
        `${String(rewardPointsPerCompletion)}+${String(accuracyBonusPoints)} pts/completion, ` +
        `allocation ${allocation.allocationId} (${String(points)} pts)`,
    );
    results.push({ campaignId: campaign.id, title: campaign.title, region, status: "funded" });
  }
  return results;
}
