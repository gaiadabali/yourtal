import type { Pool } from "pg";
import { createPool } from "../pool";
import { defineJob } from "../job";

/**
 * Group 3.9: deletes the OpenID Connect provider's own records (`oidc.model`:
 * sign-in screens, codes, grants, sessions, tokens) a day after they expire.
 * The adapter already treats them as gone at expiry; this stops the table
 * growing for ever, and stops expired rows keeping a person's user id
 * (docs/26 §2.6). Batched, so one run never holds a long lock.
 */
const BATCH = 1000;
const MAX_BATCHES_PER_RUN = 200;

let pool: Pool | undefined;
function poolFor(databaseUrl: string): Pool {
  pool ??= createPool(databaseUrl);
  return pool;
}

/** Exported for tests. Returns how many rows it deleted. */
export async function runOidcModelPurge(db: Pool, now: Date = new Date()): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const result = await db.query(
      `DELETE FROM oidc.model
        WHERE (kind, id) IN (
          SELECT kind, id FROM oidc.model
           WHERE expires_at < $1::timestamptz - interval '1 day'
           LIMIT $2)`,
      [now, BATCH],
    );
    const deleted = result.rowCount ?? 0;
    total += deleted;
    if (deleted < BATCH) break;
  }
  return total;
}

export const job = defineJob({
  queue: "oidc.model_purge",
  schedule: "23 * * * *",
  async handle(_job, { config }) {
    await runOidcModelPurge(poolFor(config.databaseUrl), new Date());
  },
});
