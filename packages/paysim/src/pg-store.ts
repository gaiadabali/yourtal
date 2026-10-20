import type {
  ClaimedDelivery,
  Delivery,
  IdempotencyRecord,
  JsonObject,
  PaySimStore,
  PaySimTx,
  StoredObject,
} from "./store";

/** What `pg.Pool` and `pg.PoolClient` already provide. */
export interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(error?: Error | boolean): void;
}
export interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<PgClientLike>;
}

type Row = Record<string, unknown>;

const OBJECT_COLUMNS = "id, type, account, data, internal, due_at";

function toObject(r: Row): StoredObject {
  return {
    id: r["id"] as string,
    type: r["type"] as string,
    account: (r["account"] as string | null) ?? null,
    data: r["data"] as JsonObject,
    internal: r["internal"] as JsonObject,
    dueAt: (r["due_at"] as Date | null) ?? null,
  };
}

function toDelivery(r: Row): Delivery {
  return {
    id: r["id"] as string,
    eventId: r["event_id"] as string,
    attempts: r["attempts"] as number,
    nextAttemptAt: r["next_attempt_at"] as Date,
    status: r["status"] as Delivery["status"],
    lastStatusCode: (r["last_status_code"] as number | null) ?? null,
    lastError: (r["last_error"] as string | null) ?? null,
  };
}

function makeTx(c: PgClientLike): PaySimTx {
  return {
    async get(id, opts) {
      const lock = opts?.forUpdate === true ? " FOR UPDATE" : "";
      const { rows } = await c.query(
        `SELECT ${OBJECT_COLUMNS} FROM paysim.object WHERE id = $1${lock}`,
        [id],
      );
      return rows[0] === undefined ? undefined : toObject(rows[0]);
    },
    async put(o) {
      await c.query(
        `INSERT INTO paysim.object (${OBJECT_COLUMNS})
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
         ON CONFLICT (id) DO UPDATE
           SET type = EXCLUDED.type, account = EXCLUDED.account, data = EXCLUDED.data,
               internal = EXCLUDED.internal, due_at = EXCLUDED.due_at, updated_at = now()`,
        [o.id, o.type, o.account, JSON.stringify(o.data), JSON.stringify(o.internal), o.dueAt],
      );
    },
    async getIdempotency(scope, key, notBefore) {
      // Two requests with one key queue here until the first commits.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${scope}\u0001${key}`,
      ]);
      const { rows } = await c.query(
        `SELECT scope, key, request_hash, status, body, created_at
           FROM paysim.idempotency WHERE scope = $1 AND key = $2 AND created_at >= $3`,
        [scope, key, notBefore],
      );
      const r = rows[0];
      if (r === undefined) return undefined;
      return {
        scope,
        key,
        requestHash: r["request_hash"] as string,
        status: r["status"] as number,
        body: r["body"] as string,
        createdAt: r["created_at"] as Date,
      } satisfies IdempotencyRecord;
    },
    async putIdempotency(rec) {
      await c.query(
        `INSERT INTO paysim.idempotency (scope, key, request_hash, status, body, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (scope, key) DO UPDATE
           SET request_hash = EXCLUDED.request_hash, status = EXCLUDED.status,
               body = EXCLUDED.body, created_at = EXCLUDED.created_at`,
        [rec.scope, rec.key, rec.requestHash, rec.status, rec.body, rec.createdAt],
      );
    },
    async enqueueDelivery(d) {
      await c.query(
        `INSERT INTO paysim.delivery (id, event_id, next_attempt_at, created_at)
         VALUES ($1, $2, $3, $4)`,
        [d.id, d.eventId, d.nextAttemptAt, d.now],
      );
    },
    async claimDueObjects(now, limit) {
      const { rows } = await c.query(
        `SELECT ${OBJECT_COLUMNS} FROM paysim.object
          WHERE due_at <= $1 ORDER BY due_at LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [now, limit],
      );
      return rows.map(toObject);
    },
  };
}

/** Postgres-backed store. `pool` is a `pg.Pool` (or anything shaped like one). */
export function createPgPaySimStore(pool: PgPoolLike): PaySimStore {
  async function withClient<T>(fn: (c: PgClientLike) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    transaction: (fn) => withClient((c) => fn(makeTx(c))),
    claimDeliveries: (now, limit, leaseMs) =>
      withClient(async (c) => {
        const { rows } = await c.query(
          `SELECT d.id, d.event_id, d.attempts, d.next_attempt_at, d.status,
                  d.last_status_code, d.last_error, o.data AS event
             FROM paysim.delivery d JOIN paysim.object o ON o.id = d.event_id
            WHERE d.status = 'pending' AND d.next_attempt_at <= $1
            ORDER BY d.next_attempt_at LIMIT $2
            FOR UPDATE OF d SKIP LOCKED`,
          [now, limit],
        );
        const lease = new Date(now.getTime() + leaseMs);
        for (const r of rows) {
          await c.query("UPDATE paysim.delivery SET next_attempt_at = $2 WHERE id = $1", [
            r["id"],
            lease,
          ]);
        }
        return rows.map((r): ClaimedDelivery => {
          const event = r["event"] as JsonObject;
          return {
            ...toDelivery(r),
            event,
            eventCreatedAt: new Date(Number(event["created"]) * 1000),
          };
        });
      }),
    async recordDelivery(id, result, now) {
      await pool.query(
        `UPDATE paysim.delivery
            SET attempts = $2, status = $3, next_attempt_at = $4,
                last_status_code = $5, last_error = $6, updated_at = $7
          WHERE id = $1`,
        [
          id,
          result.attempts,
          result.status,
          result.nextAttemptAt,
          result.lastStatusCode,
          result.lastError,
          now,
        ],
      );
    },
    async listObjects(type) {
      const { rows } =
        type === undefined
          ? await pool.query(`SELECT ${OBJECT_COLUMNS} FROM paysim.object ORDER BY created_at, id`)
          : await pool.query(
              `SELECT ${OBJECT_COLUMNS} FROM paysim.object WHERE type = $1 ORDER BY created_at, id`,
              [type],
            );
      return rows.map(toObject);
    },
    async listDeliveries() {
      const { rows } = await pool.query("SELECT * FROM paysim.delivery ORDER BY created_at, id");
      return rows.map(toDelivery);
    },
  };
}
