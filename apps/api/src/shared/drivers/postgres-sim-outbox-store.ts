import type { Pool } from "pg";
import type { SimOutboxEntry, SimOutboxRecord, SimOutboxStore } from "@yourtal/drivers/sim-outbox";

/**
 * The durable half of `SimOutboxStore`. 1.6.a/1.6.c (TASKS.md).
 *
 * `@yourtal/drivers`'s own `createInMemorySimOutboxStore` is per-process —
 * fine for that package's unit tests, but a simulated verification email
 * sent by one api instance would be invisible to `/api/dev/inbox` (1.6.b)
 * served by another, or to a worker job reading the same table. This is the
 * implementation every real boundary construction should use instead:
 * `platform.sim_outbox` (20260925180600), shared the same way
 * `platform.idempotency` is (`idempotency.module.ts`'s own reasoning).
 *
 * ## The one statement that matters
 *
 * `record` has to be idempotent per `(boundary, idempotencyKey)` without a
 * read-then-write race — the same shape `PostgresIdempotencyStore.putIfAbsent`
 * uses. `ON CONFLICT ... DO UPDATE SET boundary = EXCLUDED.boundary` rather
 * than `DO NOTHING` is deliberate: `DO NOTHING` returns no row at all on a
 * conflict, and a caller needs the ORIGINAL row back either way. The no-op
 * self-assignment is what makes `RETURNING` fire on the replay path too,
 * without actually changing anything about the first row.
 */
export class PostgresSimOutboxStore implements SimOutboxStore {
  constructor(private readonly pool: Pool) {}

  async record(entry: SimOutboxEntry): Promise<SimOutboxRecord> {
    const result = await this.pool.query<StoredRow>(
      `INSERT INTO platform.sim_outbox
         (boundary, region, recipient, category, subject, body, metadata, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (boundary, idempotency_key) DO UPDATE
         SET boundary = EXCLUDED.boundary
       RETURNING id, boundary, region, recipient, category, subject, body, metadata,
                 idempotency_key, created_at`,
      [
        entry.boundary,
        entry.region,
        entry.recipient,
        entry.category,
        entry.subject ?? null,
        entry.body,
        entry.metadata ?? {},
        entry.idempotencyKey,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("platform.sim_outbox insert returned no row");
    }
    return toRecord(row);
  }
}

interface StoredRow {
  readonly id: string;
  readonly boundary: string;
  readonly region: string;
  readonly recipient: string;
  readonly category: string;
  readonly subject: string | null;
  readonly body: string;
  readonly metadata: Record<string, unknown>;
  readonly idempotency_key: string;
  readonly created_at: Date;
}

function toRecord(row: StoredRow): SimOutboxRecord {
  return {
    id: row.id,
    // `boundary`/`region` come back from a column this migration CHECK-
    // constrains to exactly these values, so trusting the round trip here —
    // rather than re-validating with a schema — matches how every other
    // hand-rolled `pg` mapper in this app reads its own constrained columns.
    boundary: readBoundary(row.boundary),
    region: readRegion(row.region),
    recipient: row.recipient,
    category: row.category,
    ...(row.subject === null ? {} : { subject: row.subject }),
    body: row.body,
    metadata: row.metadata,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

function readBoundary(value: string): SimOutboxRecord["boundary"] {
  if (value === "email" || value === "push" || value === "webhook") return value;
  throw new Error(`platform.sim_outbox.boundary has an unexpected value: ${value}`);
}

function readRegion(value: string): SimOutboxRecord["region"] {
  if (value === "AU" || value === "ID") return value;
  throw new Error(`platform.sim_outbox.region has an unexpected value: ${value}`);
}
