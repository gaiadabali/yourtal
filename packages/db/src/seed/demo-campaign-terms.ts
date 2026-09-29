import type pg from "pg";

/**
 * Makes each seed-funded campaign promise exactly what its funding pays.
 *
 * `complete()` grants from the campaign's CURRENT terms version, while the
 * hold (and the allocation behind it) is sized from `reward_config`. The
 * demo media and fixture rows carry their own display reward (80 pts, say)
 * that no funding backs, so without this a finished watch would ask the
 * ledger for more than was held (K6). The fix appends a new terms version
 * rather than editing one: a version already watched under stays as it was.
 *
 * Also zeroes a bonus on a campaign with no questions, where it could never
 * be earned but would still be held. Runs every deploy; a no-op once aligned.
 */

const SEED_ALLOCATION_PREFIX = "alloc_demo-campaign-funding:";

interface MisalignedRow {
  readonly campaign_id: string;
  readonly version: number;
  readonly question_count: number;
  readonly duration_seconds: number;
  readonly base: string;
  readonly bonus: string;
  readonly terms_points: string;
  readonly terms_bonus: string;
  readonly scoring_rule: string;
}

export interface DemoCampaignTermsResult {
  readonly aligned: number;
}

export async function alignDemoCampaignTerms(
  pool: pg.Pool,
  log: (message: string) => void,
): Promise<DemoCampaignTermsResult> {
  // A bonus needs a question to be earned against (terms_bonus_needs_questions).
  await pool.query(
    `UPDATE campaign.reward_config rc
        SET accuracy_bonus_points = 0
       FROM campaign.campaigns c
      WHERE c.id = rc.campaign_id
        AND rc.allocation_id LIKE $1
        AND rc.accuracy_bonus_points > 0
        AND COALESCE(c.question_count, 0) = 0`,
    [`${SEED_ALLOCATION_PREFIX}%`],
  );

  const rows = await pool.query<MisalignedRow>(
    `SELECT tv.campaign_id, tv.version, tv.question_count, tv.duration_seconds,
            rc.reward_points_per_completion AS base, rc.accuracy_bonus_points AS bonus,
            tv.reward_points AS terms_points, tv.accuracy_bonus_points AS terms_bonus,
            tv.scoring_rule
       FROM campaign.reward_config rc
       JOIN LATERAL (
              SELECT * FROM campaign.terms_version t
               WHERE t.campaign_id = rc.campaign_id
               ORDER BY t.version DESC LIMIT 1
            ) tv ON true
      WHERE rc.allocation_id LIKE $1`,
    [`${SEED_ALLOCATION_PREFIX}%`],
  );

  let aligned = 0;
  for (const row of rows.rows) {
    const bonus = row.question_count > 0 ? Number(row.bonus) : 0;
    const scoring = bonus > 0 ? "base_plus_accuracy_bonus" : "base_only";
    if (
      Number(row.terms_points) === Number(row.base) &&
      Number(row.terms_bonus) === bonus &&
      row.scoring_rule === scoring
    ) {
      continue;
    }
    await pool.query(
      `INSERT INTO campaign.terms_version
         (campaign_id, version, reward_points, question_count, scoring_rule,
          duration_seconds, effective_from, accuracy_bonus_points)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
       ON CONFLICT (campaign_id, version) DO NOTHING`,
      [
        row.campaign_id,
        row.version + 1,
        row.base,
        row.question_count,
        scoring,
        row.duration_seconds,
        bonus,
      ],
    );
    // The campaign's own display reward follows, so every surface says the same number.
    await pool.query(
      `UPDATE campaign.campaigns SET reward_points = $2, scoring_rule = $3 WHERE id = $1`,
      [row.campaign_id, row.base, scoring],
    );
    aligned++;
  }
  if (aligned > 0) {
    log(
      `[seed:demo-campaign-terms] ${String(aligned)} campaigns now promise what they are funded for`,
    );
  }
  return { aligned };
}
