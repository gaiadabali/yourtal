import { Pool } from "pg";
import type { Job } from "pg-boss";
import { POINTS_UNLOCKED_QUEUE } from "@yourtal/contracts/ledger-internal/releases";
import type { PointsUnlockedEvent } from "@yourtal/contracts/ledger-internal/releases";
import { createSimulatedPush } from "@yourtal/drivers/push";
import { defineJob } from "../job";
import type { JobContext } from "../job";
import { isTeenInQuietHours } from "../teen-quiet-hours";
import { isPushEnabledFor } from "../push-default";

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

    // 12.2.b: quiet hours (21:00-07:00, the recipient's own profile
    // timezone) silence a teen entirely -- no notification row, no push.
    if (await isTeenInQuietHours(client, event.userId, new Date())) return;

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

    // 12.4.b (#8): no row means the DPIA's own default -- off for a teen,
    // on for everyone else (`push-default.ts`'s own header).
    if (!(await isPushEnabledFor(client, event.userId, category, new Date()))) return;

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
