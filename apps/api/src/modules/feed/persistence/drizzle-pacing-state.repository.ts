import { sql } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { PacingStateRepository } from "./pacing-state.repository";

/**
 * Advisory only (7.7.b) -- generous enough that it is never the reason a
 * funded, in-schedule campaign stops appearing at today's traffic. The
 * mechanism is real (a row per campaign, reset per day) so a later pass can
 * tighten it, or move it into `region_setting`, without touching callers.
 */
const DAILY_SERVE_CAP = 100_000;

export class DrizzlePacingStateRepository implements PacingStateRepository {
  constructor(private readonly db: AppDb) {}

  async canServe(campaignId: string): Promise<boolean> {
    const result = await this.db.execute<{ served_today: number; day: string }>(sql`
      SELECT served_today, day::text AS day FROM feed.pacing_state WHERE campaign_id = ${campaignId}
    `);
    const row = result.rows[0];
    if (row === undefined) return true;
    const isToday = row.day === new Date().toISOString().slice(0, 10);
    return !isToday || row.served_today < DAILY_SERVE_CAP;
  }

  async recordServe(campaignId: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await this.db.execute(sql`
      INSERT INTO feed.pacing_state (campaign_id, day, served_today, updated_at)
      VALUES (${campaignId}, ${today}, 1, now())
      ON CONFLICT (campaign_id) DO UPDATE SET
        served_today = CASE WHEN feed.pacing_state.day = ${today}
                             THEN feed.pacing_state.served_today + 1
                             ELSE 1 END,
        day = ${today},
        updated_at = now()
    `);
  }
}
