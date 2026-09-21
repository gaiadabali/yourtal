import type { Pool } from "pg";
import { PGBOSS_SCHEMA } from "./config";

/**
 * Queue observability from the database, with no collector. YT-0040.
 *
 * The ticket this package implements originally read "... and visibility
 * in Grafana"; that clause was split out to YT-0027, which owns the
 * OpenTelemetry/Grafana stack this repo does not have yet (`docker-compose.yml`
 * has no Grafana/Prometheus/Alloy/Loki/OTel collector). What is left for
 * THIS package to own: pg-boss keeps every job's state in Postgres, so
 * retry counts, dead-lettered jobs and queue depth are all plain `SELECT`s
 * against `pgboss.job`/`pgboss.queue` — evidence that exists without an
 * application process ever running, which YT-0027 can graph later without
 * this package changing at all.
 *
 * `pgboss.job` is queried directly (not `pgboss.job_common`) because it is
 * the partitioned PARENT table — Postgres answers a query against it with
 * the union of every partition, so this is correct whether or not any
 * queue in this schema uses per-queue partitioning (this repo's queues do
 * not; see `client.ts`).
 */

export interface QueueDepth {
  readonly created: number;
  readonly retry: number;
  readonly active: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly failed: number;
}

const JOB_STATES = ["created", "retry", "active", "completed", "cancelled", "failed"] as const;

export async function getQueueDepth(pool: Pool, queueName: string): Promise<QueueDepth> {
  const { rows } = await pool.query<{ state: string; count: string }>(
    `SELECT state::text, COUNT(*)::text AS count
       FROM ${PGBOSS_SCHEMA}.job
      WHERE name = $1
      GROUP BY state`,
    [queueName],
  );

  const depth: Record<string, number> = Object.fromEntries(JOB_STATES.map((s) => [s, 0]));
  for (const row of rows) {
    depth[row.state] = Number(row.count);
  }
  return depth as unknown as QueueDepth;
}

export interface JobRetrySnapshot {
  readonly id: string;
  readonly state: string;
  readonly retryCount: number;
  readonly retryLimit: number;
  readonly deadLetter: string | null;
  readonly output: unknown;
}

/** Every job on a queue with at least one retry recorded, most-retried
 * first — the "is this queue healthy" question a Grafana panel would
 * otherwise answer. */
export async function getRetriedJobs(pool: Pool, queueName: string): Promise<JobRetrySnapshot[]> {
  const { rows } = await pool.query<{
    id: string;
    state: string;
    retry_count: number;
    retry_limit: number;
    dead_letter: string | null;
    output: unknown;
  }>(
    `SELECT id::text, state::text, retry_count, retry_limit, dead_letter, output
       FROM ${PGBOSS_SCHEMA}.job
      WHERE name = $1 AND retry_count > 0
      ORDER BY retry_count DESC, created_on DESC`,
    [queueName],
  );

  return rows.map((row) => ({
    id: row.id,
    state: row.state,
    retryCount: row.retry_count,
    retryLimit: row.retry_limit,
    deadLetter: row.dead_letter,
    output: row.output,
  }));
}

export interface DeadLetteredJob {
  readonly id: string;
  readonly sourceName: string | null;
  readonly sourceId: string | null;
  readonly sourceRetryCount: number | null;
  readonly data: unknown;
  readonly output: unknown;
}

/** The jobs sitting in a dead-letter queue, with the provenance pg-boss
 * stamps at the transfer (`source_name`/`source_id`/`source_retry_count`:
 * which queue and job this came from, and how many retries it used up
 * before landing here). */
export async function getDeadLetteredJobs(
  pool: Pool,
  deadLetterQueueName: string,
): Promise<DeadLetteredJob[]> {
  const { rows } = await pool.query<{
    id: string;
    source_name: string | null;
    source_id: string | null;
    source_retry_count: number | null;
    data: unknown;
    output: unknown;
  }>(
    `SELECT id::text, source_name, source_id::text, source_retry_count, data, output
       FROM ${PGBOSS_SCHEMA}.job
      WHERE name = $1
      ORDER BY created_on DESC`,
    [deadLetterQueueName],
  );

  return rows.map((row) => ({
    id: row.id,
    sourceName: row.source_name,
    sourceId: row.source_id,
    sourceRetryCount: row.source_retry_count,
    data: row.data,
    output: row.output,
  }));
}
