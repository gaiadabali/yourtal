import { PgBoss } from "pg-boss";
import { PGBOSS_SCHEMA } from "./config";

/**
 * Builds the pg-boss client every service in this repo uses. YT-0040.
 *
 * ## The app never issues DDL for this schema — three separate switches
 *
 * `docs/14` section 8: four roles per service, `migrate` (DDL only, run by
 * the migration job) and `app_rw`/`app_ro`/`analytics` with none. That rule
 * is why `packages/idempotency` carries no DDL any more (see the doc
 * comment at the bottom of `packages/idempotency/src/record.ts`), and it
 * applies here just as hard: `DATABASE_URL` is always `yourtal_app`, which
 * `packages/db/migrations/20260921234000_pgboss_schema.sql` grants USAGE
 * and table/function privileges on `pgboss` but deliberately no CREATE.
 *
 * pg-boss's own default behaviour, unconfigured, would violate that on
 * three separate code paths, so all three are turned off explicitly here
 * rather than relied on to never trigger:
 *
 *   1. `migrate: false` — on `start()`, pg-boss normally checks the
 *      installed schema version and, if it is behind, runs its own
 *      `ALTER`/migration DDL to bring it forward (`Contractor.start()`).
 *      `migrate: false` makes it call `Contractor.check()` instead: verify
 *      the schema exists and is at the expected version, throw if not,
 *      issue no DDL either way. The migration above is what makes that
 *      check pass — it installs exactly the schema version this pinned
 *      pg-boss dependency expects.
 *   2. `createSchema: false` — belt-and-suspenders for the same path: even
 *      if `isInstalled()` somehow returned false, this stops `create()`
 *      from attempting `CREATE SCHEMA`.
 *   3. `persistQueueStats: false` — pg-boss's periodic `supervise()` pass
 *      maintains a `queue_stats` aggregate table by creating a new daily
 *      range partition for it (`ensureQueueStatsPartitions`,
 *      `CREATE TABLE ... PARTITION OF`), unconditionally, under whichever
 *      role is running — which would be `yourtal_app` here. That table only
 *      feeds pg-boss's own dashboard-style stats API; this repo answers
 *      "what does the queue look like" straight off `pgboss.job` and
 *      `pgboss.queue` instead (`./observability`), which are static tables
 *      this migration already grants on. Turning the aggregate off avoids a
 *      permission error on every supervise tick rather than depending on it
 *      never running before someone notices.
 *
 * There is a fourth rule that lives with the callers, not here: every
 * `defineQueue` call in this repo passes `partition: false` (pg-boss's own
 * default). `pgboss.create_queue()` only runs its `CREATE TABLE` branch when
 * `partition: true`; leaving it off keeps `createQueue()` a plain `INSERT`.
 * Turning partitioning on for a queue is a real scaling decision and needs
 * its own migration-and-grant story, not something to fall into by default.
 */
export interface CreateQueueClientOptions {
  /** `AppConfig.databaseUrl` — always the `yourtal_app` role. */
  readonly databaseUrl: string;
  readonly schema?: string;
  /**
   * Called with every `error` pg-boss emits (a dropped Postgres connection,
   * a failed maintenance pass). Defaults to `console.error`. Whatever it is,
   * it must not throw: the point is that the process survives.
   */
  readonly onError?: (error: Error) => void;
}

export function createQueueClient(options: CreateQueueClientOptions): PgBoss {
  const boss = new PgBoss({
    connectionString: options.databaseUrl,
    schema: options.schema ?? PGBOSS_SCHEMA,
    migrate: false,
    createSchema: false,
    persistQueueStats: false,
  });
  attachQueueErrorHandler(boss, options.onError ?? defaultOnError);
  return boss;
}

/**
 * pg-boss is an EventEmitter and re-emits connection errors ("Connection
 * terminated unexpectedly" when Postgres restarts or a pooled connection is
 * cut) as `error`. An `error` event with no listener is thrown by Node and
 * takes the whole process down, so the api and the worker both used to exit
 * on a database blip. With a listener, pg-boss keeps its own pool and
 * supervisor timers and reconnects on the next tick; we only log. 13.3.t.
 */
export function attachQueueErrorHandler(boss: PgBoss, onError: (error: Error) => void): void {
  boss.on("error", (error: Error) => {
    try {
      onError(error);
    } catch {
      // A throwing logger must not turn a survivable error into a crash.
    }
  });
}

function defaultOnError(error: Error): void {
  console.error(`[queue] pg-boss error (it will reconnect): ${error.message}`);
}
