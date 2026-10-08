import type { Pool } from "pg";
import { createPool } from "../pool";
import type { Job } from "pg-boss";
import { POINTS_EXPIRING_QUEUE } from "@yourtal/contracts/ledger-internal/expiry";
import type { PointsExpiringEvent } from "@yourtal/contracts/ledger-internal/expiry";
import { createSimulatedPush } from "@yourtal/drivers/push";
import { defineJob } from "../job";
import type { JobContext } from "../job";
import { isTeenAccount } from "../teen-quiet-hours";
import { isPushEnabledFor } from "../push-default";

/**
 * TASKS.md 10.2.d: turns each `ledger.points_expiring` event into an in-app
 * notification plus a simulated push — the same shape
 * points-unlocked-notify.ts already uses for `ledger.points_unlocked`,
 * finishing the one source that file's own header named as "not started:
 * no expiry exists yet to notify about".
 *
 * Points expiry is off by default per region (F2); this job never fires at
 * all for a region where nobody has turned it on, because the ledger's own
 * sweep (10.2.a) never writes a notice in that case.
 */
let pool: Pool | undefined;
function poolFor(databaseUrl: string): Pool {
  pool ??= createPool(databaseUrl);
  return pool;
}

const push = createSimulatedPush();

export const job = defineJob<PointsExpiringEvent>({
  queue: POINTS_EXPIRING_QUEUE,
  async handle(jobRecord: Job<PointsExpiringEvent>, { config }: JobContext) {
    const event = jobRecord.data;
    const client = poolFor(config.databaseUrl);

    // 12.4.d/#7: a teen never gets the expiry nudge at all, not only
    // overnight -- "act now or lose it" pressure is exactly what teen mode
    // exists to soften. No notification row, no push, any time of day.
    if (await isTeenAccount(client, event.userId, new Date())) return;

    const category = "points_expiring";
    const title =
      event.milestoneDays === 30 ? "Points expiring in 30 days" : "Points expiring in 7 days";
    const body = `${String(event.points)} pts will expire on ${event.expiringAt.slice(0, 10)} unless you use them.`;

    await client.query(
      `INSERT INTO me.notification (user_id, region, category, title, body, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.userId,
        event.region,
        category,
        title,
        body,
        JSON.stringify({
          accountId: event.accountId,
          milestoneDays: event.milestoneDays,
          expiringAt: event.expiringAt,
          points: event.points,
        }),
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
