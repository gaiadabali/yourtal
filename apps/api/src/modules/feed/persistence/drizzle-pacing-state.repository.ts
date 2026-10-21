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

  async canServeMany(campaignIds: readonly string[]): Promise<ReadonlyMap<string, boolean>> {
    if (campaignIds.length === 0) return new Map();
    const result = await this.db.execute<{
      campaign_id: string;
      served_today: number;
      day: string;
    }>(sql`
      SELECT campaign_id, served_today, day::text AS day FROM feed.pacing_state
       WHERE campaign_id IN (${sql.join(
         campaignIds.map((id) => sql`${id}`),
         sql`, `,
       )})
    `);
    const today = new Date().toISOString().slice(0, 10);
    const rows = new Map(result.rows.map((row) => [row.campaign_id, row]));
    return new Map(
      campaignIds.map((id) => {
        const row = rows.get(id);
        return [id, row === undefined || row.day !== today || row.served_today < DAILY_SERVE_CAP];
      }),
    );
  }

  async recordServes(campaignIds: readonly string[]): Promise<void> {
    if (campaignIds.length === 0) return;
    // One row per distinct campaign, bumped by how many times it was served (an `ON CONFLICT` cannot touch a row twice).
    const counts = new Map<string, number>();
    for (const id of campaignIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const today = new Date().toISOString().slice(0, 10);
    // Sorted, so two concurrent feeds that serve the same campaigns lock their rows in the same order and cannot deadlock.
    const values = sql.join(
      [...counts]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, n]) => sql`(${id}::uuid, ${today}::date, ${n}::int, now())`),
      sql`, `,
    );
    await this.db.execute(sql`
      INSERT INTO feed.pacing_state (campaign_id, day, served_today, updated_at)
      VALUES ${values}
      ON CONFLICT (campaign_id) DO UPDATE SET
        served_today = CASE WHEN feed.pacing_state.day = EXCLUDED.day
                             THEN feed.pacing_state.served_today + EXCLUDED.served_today
                             ELSE EXCLUDED.served_today END,
        day = EXCLUDED.day,
        updated_at = now()
    `);
  }

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
