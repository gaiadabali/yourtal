import type { Pool } from "pg";
import type { SimOutboxRecord } from "@yourtal/drivers/sim-outbox";

export const SIM_OUTBOX_READER = Symbol("SIM_OUTBOX_READER");

/**
 * The read half of `platform.sim_outbox`, 1.6.b. `SimOutboxStore` (the write
 * half every boundary driver shares) deliberately has no read method of its
 * own — see its header — because reading is a reviewer's concern, not a
 * boundary's, and lives here in `apps/api` rather than in `packages/drivers`
 * for the same reason `PostgresSimOutboxStore` does.
 *
 * `sim_outbox_boundary_created_at_idx` is `(boundary, created_at DESC)`, so a
 * per-boundary query is an index scan; this reads across every boundary
 * (email, push, webhook) instead, newest first, because `/api/dev/inbox` is
 * a reviewer's single view of everything simulated, not just email — a
 * per-boundary filter is a client-side concern (or a later query param) if
 * one is ever needed.
 */
export class PostgresSimOutboxReader {
  constructor(private readonly pool: Pool) {}

  async listRecent(limit = 50): Promise<SimOutboxRecord[]> {
    const { rows } = await this.pool.query<StoredRow>(
      `SELECT id, boundary, region, recipient, category, subject, body, metadata,
              idempotency_key, created_at
         FROM platform.sim_outbox
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows.map(toRecord);
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
    // Trusting the round trip against this migration's own CHECK
    // constraints — the same convention `PostgresSimOutboxStore.toRecord`
    // already documents at length for the identical columns.
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
