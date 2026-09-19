import type { Pool } from "pg";
import { idempotencyRecordSchema } from "./record";
import type { IdempotencyRecord } from "./record";
import type { IdempotencyStore } from "./store";

/**
 * The durable idempotency store. YT-0515.
 *
 * Replaces `InMemoryIdempotencyStore`, which was never an idempotency store:
 * being per-process, two instances behind a load balancer each kept their own
 * map, so a retry landing on the other instance executed the operation a
 * second time.
 *
 * Table: `platform.idempotency`, created by the YT-0518 migration and shared
 * by every service (`docs/10` line 226) so a retry that arrives at a
 * different service still finds the record.
 *
 * ## The one statement that matters
 *
 * `putIfAbsent` has to be atomic or the whole package is decorative — two
 * concurrent retries must not both be told "you are first". A read followed
 * by a write cannot do that at any isolation level we would want on the
 * request path, so it is one statement:
 *
 *   INSERT ... ON CONFLICT (scope, key) DO UPDATE ... WHERE <expired>
 *
 * The `DO UPDATE ... WHERE` is doing something less obvious than a plain
 * `DO NOTHING`. An EXPIRED row must behave as if absent — the key is free to
 * reuse, and a dead row reporting "in progress" would wedge a legitimate
 * retry until someone noticed. `DO NOTHING` cannot express "unless it is
 * expired, in which case take it over"; the conditional update can, and it
 * does so inside the same atomic statement rather than as a read-modify-write
 * race of its own.
 *
 * When the conflict target is live, the `WHERE` fails, no row is returned,
 * and the caller is not the winner. We then read the holder in a second query
 * — safe, because at that point we already know we did not win, and the row
 * we read can only have been written by whoever did.
 */
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: Pool) {}

  async putIfAbsent(record: IdempotencyRecord): Promise<IdempotencyRecord | undefined> {
    const claim = idempotencyRecordSchema.parse(record);

    const claimed = await this.pool.query<StoredRow>(
      `INSERT INTO platform.idempotency (scope, key, fingerprint, state, started_at, expires_at)
       VALUES ($1, $2, $3, 'in_progress', $4, $5)
       ON CONFLICT (scope, key) DO UPDATE
         SET fingerprint = EXCLUDED.fingerprint,
             state       = 'in_progress',
             status      = NULL,
             body        = NULL,
             started_at  = EXCLUDED.started_at,
             expires_at  = EXCLUDED.expires_at
         WHERE platform.idempotency.expires_at <= EXCLUDED.started_at
       RETURNING scope, key, fingerprint, state, status, body, started_at, expires_at`,
      [claim.scope, claim.key, claim.fingerprint, claim.startedAt, claim.expiresAt],
    );

    if (claimed.rowCount === 1) {
      return undefined;
    }

    const holder = await this.pool.query<StoredRow>(
      `SELECT scope, key, fingerprint, state, status, body, started_at, expires_at
         FROM platform.idempotency
        WHERE scope = $1 AND key = $2`,
      [claim.scope, claim.key],
    );

    const row = holder.rows[0];
    if (row === undefined) {
      // The holder expired and was pruned between our two statements. Nobody
      // holds the key, but we did not claim it either — reporting it as held
      // would be a lie, and reporting "proceed" would skip the claim. Let the
      // caller retry the claim rather than guess.
      throw new Error(
        `idempotency: key ${claim.key} was neither claimed nor held; retry the request`,
      );
    }
    return toRecord(row);
  }

  async complete(
    scope: string,
    key: string,
    response: { status: number; body: string },
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE platform.idempotency
          SET state = 'completed', status = $3, body = $4
        WHERE scope = $1 AND key = $2`,
      [scope, key, response.status, response.body],
    );

    if (result.rowCount === 0) {
      // A broken begin/complete pairing. Failing loudly beats leaving a
      // response nothing will ever replay.
      throw new Error(`cannot complete an idempotency record that does not exist: ${key}`);
    }
  }

  async abandon(scope: string, key: string): Promise<void> {
    await this.pool.query(`DELETE FROM platform.idempotency WHERE scope = $1 AND key = $2`, [
      scope,
      key,
    ]);
  }

  async prune(now: Date): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM platform.idempotency WHERE expires_at <= $1`,
      [now.toISOString()],
    );
    return result.rowCount ?? 0;
  }
}

interface StoredRow {
  scope: string;
  key: string;
  fingerprint: string;
  state: string;
  status: number | null;
  body: string | null;
  started_at: Date;
  expires_at: Date;
}

function toRecord(row: StoredRow): IdempotencyRecord {
  return idempotencyRecordSchema.parse({
    scope: row.scope,
    key: row.key,
    fingerprint: row.fingerprint,
    state: row.state,
    ...(row.status !== null && row.body !== null
      ? { response: { status: row.status, body: row.body } }
      : {}),
    startedAt: row.started_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  });
}
