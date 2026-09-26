import { sql } from "drizzle-orm";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * The shared arithmetic `balance`, `burnForVoucher` and `escrow` all need, in
 * one place so the call sites cannot drift on what "available" means.
 *
 * It mirrors the live ledger's escrow: a held escrow takes available first,
 * then pending, and while any escrow is held nothing unlocks (4.4.g), so a
 * grant counts as unlocked only if its unlock time came before the earliest
 * held escrow (or at grant time, the no-holdback tier).
 */
const unlocked = (userId: string) => sql`
  unlock_at <= LEAST(now(), COALESCE((SELECT MIN(created_at) FROM platform.ledger_fake_escrow
                                       WHERE user_id = ${userId} AND state = 'held'), now()))
  OR unlock_at <= granted_at`;

export async function availablePoints(db: AppDb, userId: string): Promise<number> {
  const result = await db.execute<{ available: string }>(sql`
    SELECT
      COALESCE((SELECT SUM(points) FROM platform.ledger_fake_grant
                 WHERE user_id = ${userId} AND NOT reversed AND (${unlocked(userId)})), 0)
      - COALESCE((SELECT SUM(points) FROM platform.ledger_fake_burn
                   WHERE user_id = ${userId} AND state = 'burned'), 0)
      - COALESCE((SELECT SUM(points - pending_points) FROM platform.ledger_fake_escrow
                   WHERE user_id = ${userId} AND state = 'held'), 0)
      AS available
  `);
  return Number(result.rows[0]?.available ?? 0);
}

export interface FakePendingBucket {
  readonly unlockAt: Date;
  readonly points: number;
}

/**
 * Pending points by unlock time, earliest first. What a held escrow took from
 * pending comes off the latest unlocks, as the live ledger shows it.
 */
export async function pendingBuckets(db: AppDb, userId: string): Promise<FakePendingBucket[]> {
  const rows = await db.execute<{ unlock_at: string; points: string }>(sql`
    SELECT unlock_at, SUM(points) AS points FROM platform.ledger_fake_grant
     WHERE user_id = ${userId} AND NOT reversed AND NOT (${unlocked(userId)})
     GROUP BY unlock_at ORDER BY unlock_at
  `);
  const escrowed = await db.execute<{ points: string }>(sql`
    SELECT COALESCE(SUM(pending_points), 0) AS points FROM platform.ledger_fake_escrow
     WHERE user_id = ${userId} AND state = 'held'
  `);
  const buckets = rows.rows.map((row) => ({
    unlockAt: new Date(row.unlock_at),
    points: Number(row.points),
  }));
  let left =
    buckets.reduce((sum, bucket) => sum + bucket.points, 0) - Number(escrowed.rows[0]?.points ?? 0);
  const kept: FakePendingBucket[] = [];
  for (const bucket of buckets) {
    if (left <= 0) break;
    const points = Math.min(bucket.points, left);
    left -= points;
    kept.push({ unlockAt: bucket.unlockAt, points });
  }
  return kept;
}
