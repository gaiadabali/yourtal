import type { Pool } from "pg";
import { receiversFor } from "@yourtal/contracts/oidc/event-receivers";
import type { EventReceiver } from "@yourtal/contracts/oidc/event-receivers";
import { forgetConnectedApps } from "@yourtal/db/dsar-handlers";
import { createPool } from "../pool";
import { defineJob } from "../job";

/**
 * Group 3.7 Y4 (docs/29 §4.2), every 30 minutes:
 * - The orphan sweep. A deletion carries on past a failed `connected_apps` step, and by then the
 *   person cannot retry, so this tells the apps about everyone who still has an `oidc.subject` row
 *   ten minutes after their profile is gone. Same handler as the deletion, so with no receivers
 *   configured it throws (fails closed) rather than dropping the subs untold.
 * - Purges outbox rows delivered more than 30 days ago (they hold the app's `sub`).
 */
const BATCH = 100;

export async function sweepOrphanSubjects(
  db: Pool,
  receivers: readonly EventReceiver[],
  log: (message: string) => void = (message) => console.error(message),
): Promise<{ readonly forgotten: number; readonly failed: number }> {
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT DISTINCT s.user_id FROM oidc.subject s
      WHERE s.created_at < now() - interval '10 minutes'
        AND NOT EXISTS (SELECT 1 FROM identity.user_profile p WHERE p.user_id = s.user_id)
      LIMIT $1`,
    [BATCH],
  );
  const forget = forgetConnectedApps(db, receivers);
  let forgotten = 0;
  let failed = 0;
  for (const { user_id: userId } of rows) {
    try {
      await forget(userId);
      forgotten += 1;
    } catch (error) {
      failed += 1;
      // The user id of a deleted account, never a sub; the next run tries again.
      log(
        `[app-event] sweep failed for ${userId}: ${error instanceof Error ? error.message : "?"}`,
      );
    }
  }
  return { forgotten, failed };
}

export async function purgeDeliveredEvents(db: Pool, now: Date = new Date()): Promise<number> {
  const result = await db.query(
    `DELETE FROM oidc.event_outbox WHERE delivered_at < $1::timestamptz - interval '30 days'`,
    [now],
  );
  return result.rowCount ?? 0;
}

let pool: Pool | undefined;

export const job = defineJob({
  queue: "oidc.app_event_sweep",
  schedule: "*/30 * * * *",
  async handle(_job, { config }) {
    pool ??= createPool(config.databaseUrl);
    await sweepOrphanSubjects(pool, receiversFor(config.appEnv));
    await purgeDeliveredEvents(pool);
  },
});
