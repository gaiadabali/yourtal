import { Pool } from "pg";
import type { Job } from "pg-boss";
import { POINTS_UNLOCKED_QUEUE } from "@yourtal/contracts/ledger-internal/releases";
import type { PointsUnlockedEvent } from "@yourtal/contracts/ledger-internal/releases";
import { createSimulatedPush } from "@yourtal/drivers/push";
import { defineJob } from "../job";
import type { JobContext } from "../job";

/**
 * 5.5.b: turns each `ledger.points_unlocked` event (real today — 4.4.g's
 * `points-unlocked.ts` job already announces every holdback release) into
 * an in-app notification row plus a simulated push. The other two sources
 * TASKS.md names for this endpoint — `ledger.points_expiring` (10.2, not
 * started: no expiry exists yet to notify about) and new campaigns from
 * followed channels (needs 7.3's publish event, not built — see this
 * session's report for the `(requested by B)` note) — have no queue to
 * consume yet, so this file only ever wires the one that is real.
 *
 * Raw `pg` rather than Drizzle: `apps/worker` has no Drizzle client of its
 * own (only `apps/api`'s modules do, and importing across sibling apps is
 * not this codebase's convention), and one INSERT plus one SELECT does not
 * need an ORM.
 */
let pool: Pool | undefined;
function poolFor(databaseUrl: string): Pool {
  pool ??= new Pool({ connectionString: databaseUrl });
  return pool;
}

const push = createSimulatedPush();

export const job = defineJob<PointsUnlockedEvent>({
  queue: POINTS_UNLOCKED_QUEUE,
  async handle(jobRecord: Job<PointsUnlockedEvent>, { config }: JobContext) {
    const event = jobRecord.data;
    const client = poolFor(config.databaseUrl);

    const category = "points_unlocked";
    const title = "Points unlocked";
    const body = `${String(event.points)} pts are now available to spend.`;

    await client.query(
      `INSERT INTO me.notification (user_id, region, category, title, body, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.userId,
        event.region,
        category,
        title,
        body,
        JSON.stringify({ grantId: event.grantId, points: event.points }),
      ],
    );

    const preference = await client.query<{ push_enabled: boolean }>(
      `SELECT push_enabled FROM me.notification_preference WHERE user_id = $1 AND category = $2`,
      [event.userId, category],
    );
    // No row means the default (enabled) — see notification.repository.ts's own convention.
    const pushEnabled = preference.rows[0]?.push_enabled ?? true;
    if (!pushEnabled) return;

    await push.send({
      idempotencyKey: event.idempotencyKey,
      to: event.userId,
      region: event.region,
      category,
      title,
      body,
    });
  },
});
