import { sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type {
  CampaignBudget,
  CampaignBudgetsRequest,
} from "@yourtal/contracts/ledger-internal/funding";
import { toPoints } from "@yourtal/contracts/money";
import { REGION_TIMEZONE } from "@yourtal/contracts/me/streak";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * 14.2 in the fake ledger: a campaign's total budget and daily cap, with live
 * session holds counted as spent, the same rule services/ledger's
 * `reward/budget.go` enforces. Checked under a per-campaign transaction lock
 * so two sessions cannot both take the last of either.
 */
type Executor = Pick<AppDb, "execute">;

type UseRow = {
  readonly campaign_id: string;
  readonly max_points_for_campaign: string;
  readonly daily_cap_points: string | null;
  readonly granted: string;
  readonly granted_today: string;
  readonly held: string;
};

async function campaignUse(
  executor: Executor,
  campaignIds: readonly string[],
  region: "AU" | "ID",
  ownHoldId: string,
): Promise<UseRow[]> {
  if (campaignIds.length === 0) return [];
  const tz = REGION_TIMEZONE[region];
  const ids = sql.join(
    campaignIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await executor.execute<UseRow>(sql`
    SELECT r.campaign_id::text AS campaign_id, r.max_points_for_campaign, r.daily_cap_points,
           COALESCE((SELECT SUM(g.points) FROM platform.ledger_fake_grant g
                      WHERE g.campaign_id = r.campaign_id AND NOT g.reversed), 0) AS granted,
           COALESCE((SELECT SUM(g.points) FROM platform.ledger_fake_grant g
                      WHERE g.campaign_id = r.campaign_id AND NOT g.reversed
                        AND g.granted_at >= (date_trunc('day', now() AT TIME ZONE ${tz})) AT TIME ZONE ${tz}), 0) AS granted_today,
           COALESCE((SELECT SUM(h.points) FROM platform.ledger_fake_hold h
                      WHERE h.campaign_id = r.campaign_id AND h.state = 'held'
                        AND (h.expires_at IS NULL OR h.expires_at > now()) AND h.id <> ${ownHoldId}), 0) AS held
      FROM campaign.reward_config r
      JOIN campaign.campaigns c ON c.id = r.campaign_id
     WHERE r.campaign_id IN (${ids}) AND c.region = ${region}
  `);
  return result.rows;
}

function budgetOf(row: UseRow): CampaignBudget {
  const committed = Number(row.granted) + Number(row.held);
  const today =
    row.daily_cap_points === null
      ? null
      : Math.max(0, Number(row.daily_cap_points) - Number(row.granted_today) - Number(row.held));
  return {
    campaignId: row.campaign_id,
    remainingPoints: toPoints(Math.max(0, Number(row.max_points_for_campaign) - committed)),
    remainingTodayPoints: today === null ? null : toPoints(today),
  };
}

/**
 * Admits `points` against the campaign's budget and today's cap, inside the
 * caller's transaction. `ownHoldId` is the hold the caller is about to
 * consume, left out of the live holds.
 */
export async function campaignBudgetRefusal(
  tx: Executor,
  campaignId: string,
  region: "AU" | "ID",
  ownHoldId: string,
  points: number,
): Promise<LedgerError | null> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fake.campaign:${campaignId}`}, 0))`,
  );
  const [row] = await campaignUse(tx, [campaignId], region, ownHoldId);
  // No reward config: the real ledger refuses such a grant before this point
  // (`campaignGrant`); the fake never has, and has no budget to count here.
  if (row === undefined) return null;
  const budget = budgetOf(row);
  if (points > budget.remainingPoints) {
    return ledgerError(
      "campaign_cap_reached",
      `${String(points)} more would pass the budget (${String(budget.remainingPoints)} left)`,
    );
  }
  if (budget.remainingTodayPoints !== null && points > budget.remainingTodayPoints) {
    return ledgerError(
      "campaign_daily_cap_reached",
      `${String(points)} more would pass today's cap (${String(budget.remainingTodayPoints)} left)`,
    );
  }
  return null;
}

/** The campaign's region, which decides its day (F16). */
export async function campaignRegion(
  executor: Executor,
  campaignId: string,
): Promise<"AU" | "ID" | null> {
  const result = await executor.execute<{ region: "AU" | "ID" }>(
    sql`SELECT region FROM campaign.campaigns WHERE id = ${campaignId}`,
  );
  return result.rows[0]?.region ?? null;
}

export function campaignBudgets(
  db: AppDb,
  request: CampaignBudgetsRequest,
): ResultAsync<readonly CampaignBudget[], LedgerError> {
  return ResultAsync.fromSafePromise(
    campaignUse(db, request.campaignIds, request.region, "").then((rows) => rows.map(budgetOf)),
  );
}
