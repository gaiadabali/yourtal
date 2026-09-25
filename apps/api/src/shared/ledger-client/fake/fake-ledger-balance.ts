import { sql } from "drizzle-orm";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * The shared arithmetic `balance`, `burnForVoucher` and `escrow` all need:
 * available points are unlocked, unreversed grants minus active burns minus
 * held escrows. One function so the three call sites cannot drift on what
 * "available" means — the same worry `campaignTermsSchema`'s header names
 * for reward-affecting fields, one level down.
 */
export async function availablePoints(db: AppDb, userId: string): Promise<number> {
  const result = await db.execute<{ available: string }>(sql`
    SELECT
      COALESCE((SELECT SUM(points) FROM platform.ledger_fake_grant
                 WHERE user_id = ${userId} AND unlock_at <= now() AND NOT reversed), 0)
      - COALESCE((SELECT SUM(points) FROM platform.ledger_fake_burn
                   WHERE user_id = ${userId} AND state = 'burned'), 0)
      - COALESCE((SELECT SUM(points) FROM platform.ledger_fake_escrow
                   WHERE user_id = ${userId} AND state = 'held'), 0)
      AS available
  `);
  return Number(result.rows[0]?.available ?? 0);
}
