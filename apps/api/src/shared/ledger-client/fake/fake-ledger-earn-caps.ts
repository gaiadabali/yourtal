import { sql } from "drizzle-orm";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { AgeBand } from "@yourtal/contracts/ledger-internal/rewards";
import { REGION_TIMEZONE } from "@yourtal/contracts/me/streak";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * F12's earn caps, as services/ledger's `reward.Engine.checkCaps` applies
 * them to EVERY grant (grantAction and grantReward alike, since 4.4.k): the
 * region's approved `daily_earn_cap` and `monthly_earn_cap`, or for a teen
 * (12.1.c) `teen_daily_earn_cap` and a monthly ceiling of 30x that, floored
 * by the adult monthly. "Today" and "this month" are the region's own
 * calendar, and the test is `earned + this grant > limit`, day then month.
 * Both ledgers read the settings on every grant, with no cache. Go also
 * applies per-action, per-device and per-IP caps and the risk gate before
 * this; the fake has none of those.
 *
 * Read with plain SQL rather than `DrizzleRegionSettingsReader`: the check
 * must run on the grant's own transaction (`tx`), not the outer `db`.
 */
export async function earnCapRefusal(
  executor: Pick<AppDb, "execute">,
  request: { userId: string; region: "AU" | "ID"; points: number; ageBand?: AgeBand | undefined },
): Promise<LedgerError | null> {
  // The grant's own critical section, as Go's LockUserGrants: two concurrent
  // grants for one user cannot both read the same "earned so far".
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended('fake-ledger.grant:' || ${request.userId}::text, 0))
  `);

  const settingRows = await executor.execute<{ key: string; value: unknown }>(sql`
    SELECT DISTINCT ON (key) key, value FROM platform.region_setting
     WHERE region = ${request.region}
       AND key IN ('daily_earn_cap', 'monthly_earn_cap', 'teen_daily_earn_cap')
       AND approved_by IS NOT NULL AND effective_from <= now()
     ORDER BY key, effective_from DESC
  `);
  const caps = new Map(settingRows.rows.map((row) => [row.key, row.value]));
  const daily = caps.get("daily_earn_cap");
  const monthly = caps.get("monthly_earn_cap");
  const teenDaily = caps.get("teen_daily_earn_cap");
  // Go refuses an unconfigured region rather than defaulting a cap.
  if (typeof daily !== "number" || typeof monthly !== "number" || typeof teenDaily !== "number") {
    return ledgerError("velocity_capped", `earn caps are not configured for ${request.region}`);
  }

  const teen = request.ageBand === "teen";
  const dailyLimit = teen ? teenDaily : daily;
  const monthlyLimit = teen ? Math.min(teenDaily * 30, monthly) : monthly;

  const tz = REGION_TIMEZONE[request.region];
  const earnedRows = await executor.execute<{ today: string; this_month: string }>(sql`
    SELECT COALESCE(SUM(points) FILTER (
             WHERE granted_at >= (date_trunc('day', now() AT TIME ZONE ${tz})) AT TIME ZONE ${tz}
           ), 0) AS today,
           COALESCE(SUM(points), 0) AS this_month
      FROM platform.ledger_fake_grant
     WHERE user_id = ${request.userId} AND region = ${request.region}
       AND granted_at >= (date_trunc('month', now() AT TIME ZONE ${tz})) AT TIME ZONE ${tz}
  `);
  const earned = earnedRows.rows[0];
  for (const [period, limit, total] of [
    ["day", dailyLimit, Number(earned?.today ?? 0)],
    ["month", monthlyLimit, Number(earned?.this_month ?? 0)],
  ] as const) {
    if (total + request.points > limit) {
      return ledgerError(
        "velocity_capped",
        `earn cap reached: ${String(total)} + ${String(request.points)} over the ${period} cap of ${String(limit)}`,
      );
    }
  }
  return null;
}
