-- Atlas wraps this file in its own transaction (no `txmode none`), and the
-- advisory lock below binds to THAT transaction. pg-boss ships this SQL with
-- its own BEGIN/COMMIT because it is written to run standalone; keeping those
-- here ended Atlas's transaction mid-file and left the connection idle, which
-- is what `pq: unexpected transaction status idle` was. Removed rather than
-- kept with `txmode none`: one transaction is simpler than two cooperating.
--
-- YT-0040: pg-boss's OWN schema, installed by the migration job, never by
-- the app at boot.
--
-- ## Why this is a migration and not pg-boss's built-in installer
--
-- docs/14 section 8: "Four roles per service — `migrate` (DDL only, used by
-- the migration job and never by the app), `app_rw`, ...". `yourtal_app`
-- (`DATABASE_URL`, what every deployed process actually connects as) holds
-- no CREATE grant on any schema, by design — the same reason
-- `packages/idempotency` carries no DDL of its own any more (see the doc
-- comment at the bottom of `packages/idempotency/src/record.ts`).
--
-- pg-boss's default behaviour on `new PgBoss(...).start()` is to create its
-- own schema the first time it sees one missing. Left alone, that is a
-- second migration job hiding inside application code, running under
-- whatever role happens to be configured — exactly the shape of mistake
-- `docs/14`'s four-role split exists to make impossible. So the app's
-- client (`packages/queue/src/client.ts`) is constructed with
-- `migrate: false`, which makes pg-boss call `Contractor.check()` on start
-- instead of `Contractor.start()` — it verifies the schema exists at the
-- expected version and throws if not, but never issues DDL. This migration
-- is what makes that check pass.
--
-- ## Why the SQL below is pg-boss's own plan, verbatim
--
-- This is the exact output of `getConstructionPlans('pgboss')` from
-- `pg-boss@12.30.0` (the version pinned in `packages/queue/package.json` —
-- pinned, not a range, because the schema version this file installs
-- (40) has to match the schema version the installed client expects; pg-
-- boss refuses to run against a schema at any other version). Copied
-- rather than re-derived by hand, for the same reason `record.ts` gives for
-- deleting this package's own idempotency DDL: a hand-maintained copy of
-- someone else's schema drifts, and the drift is invisible until a client
-- built against a newer version meets an older table shape. Regenerating
-- this file for a future pg-boss upgrade means re-running that same call
-- against the new version and replacing the block below, plus a new
-- migration for `getMigrationPlans('pgboss', 40)` rather than editing this
-- one — this file is what v40 installs from empty, not a running record of
-- every version this database has ever been.
--
-- `-- atlas:txmode none` (the first line of this file) is required, not
-- decorative: the plan below opens its own `BEGIN`/advisory-lock/`COMMIT`
-- (pg-boss's own guard against two processes installing at once), and
-- Atlas's default per-file transaction would otherwise wrap a second BEGIN
-- around it and fight over the COMMIT.
    SET LOCAL lock_timeout = 30000;
    SET LOCAL idle_in_transaction_session_timeout = 30000;
    SELECT pg_advisory_xact_lock(('x' || encode(sha224((current_database() || '.pgboss.pgboss')::bytea), 'hex'))::bit(64)::bigint);
CREATE SCHEMA IF NOT EXISTS pgboss;

    CREATE TYPE pgboss.job_state AS ENUM (
      'created',
      'retry',
      'active',
      'completed',
      'cancelled',
      'failed'
    )
  ;

    CREATE TABLE pgboss.version (
      version int primary key,
      cron_on timestamp with time zone,
      bam_on timestamp with time zone,
      flow_on timestamp with time zone,
      reindex_on timestamp with time zone,
      monitor_backoff_on timestamp with time zone
    )
  ;

    CREATE TABLE pgboss.queue (
      name text NOT NULL,
      policy text NOT NULL,
      retry_limit int NOT NULL,
      retry_delay int NOT NULL,
      retry_backoff bool NOT NULL,
      retry_delay_max int,
      expire_seconds int NOT NULL,
      retention_seconds int NOT NULL,
      deletion_seconds int NOT NULL,
      dead_letter text REFERENCES pgboss.queue (name) CHECK (dead_letter IS DISTINCT FROM name),
      partition bool NOT NULL,
      table_name text NOT NULL,
      deferred_count int NOT NULL default 0,
      queued_count int NOT NULL default 0,
      ready_count int NOT NULL default 0,
      warning_queued int NOT NULL default 0,
      active_count int NOT NULL default 0,
      failed_count int NOT NULL default 0,
      total_count int NOT NULL default 0,
      ready_history int[] NOT NULL default '{}',
      heartbeat_seconds int,
      notify bool NOT NULL DEFAULT false,
      singletons_active text[],
      -- Two stamps, not one. monitor_claim_on is the interval claim that decides which instance
      -- runs a monitor pass; monitor_on is when this queue's counts were actually written, and is
      -- stamped only by the aggregate that wrote them (see cacheQueueStats). Splitting them is what
      -- lets a pass be claimed and then skip the aggregate — because the vacuum backoff is in force,
      -- or because another instance holds the stats try-lock — without capturedOn claiming a
      -- freshness the counts do not have.
      monitor_claim_on timestamp with time zone,
      monitor_on timestamp with time zone,
      maintain_on timestamp with time zone,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      PRIMARY KEY (name)
    )
  ;

    CREATE TABLE pgboss.schedule (
      name text REFERENCES pgboss.queue ON DELETE CASCADE,
      key text not null DEFAULT '',
      cron text not null,
      timezone text,
      data jsonb,
      options jsonb,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      PRIMARY KEY (name, key)
    )
  ;

    CREATE TABLE pgboss.subscription (
      event text not null,
      name text not null REFERENCES pgboss.queue ON DELETE CASCADE,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      PRIMARY KEY(event, name)
    )
  ;

    CREATE TABLE pgboss.bam (
      id uuid PRIMARY KEY default gen_random_uuid(),
      name text NOT NULL,
      version int NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      queue text,
      table_name text NOT NULL,
      command text NOT NULL,
      error text,
      created_on timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      started_on timestamp with time zone,
      completed_on timestamp with time zone
    )
  ;

    CREATE FUNCTION pgboss.job_table_format(command text, table_name text)
    RETURNS text AS
    $$
      SELECT format(
        regexp_replace(
          regexp_replace(command, '\.job\y', '.%1$I', 'g'),
          '\yjob_i(\d+)', '%1$s_i\1', 'g'
        ),
        table_name
      );
    $$
    LANGUAGE sql IMMUTABLE;
  ;

    CREATE FUNCTION pgboss.job_table_run(command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
    RETURNS VOID AS
    $$
    DECLARE
      tbl RECORD;
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        EXECUTE pgboss.job_table_format(command, tbl_name);
        RETURN;
      END IF;

      EXECUTE pgboss.job_table_format(command, 'job_common');

      FOR tbl IN SELECT table_name FROM pgboss.queue WHERE partition = true
      LOOP
        EXECUTE pgboss.job_table_format(command, tbl.table_name);
      END LOOP;
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE FUNCTION pgboss.job_table_run_async(command_name text, version int, command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
    RETURNS VOID AS
    $$
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
        VALUES (
          command_name,
          version,
          'pending',
          queue_name,
          tbl_name,
          pgboss.job_table_format(command, tbl_name)
        );
        RETURN;
      END IF;

      INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
      SELECT
        command_name,
        version,
        'pending',
        NULL,
        'job_common',
        pgboss.job_table_format(command, 'job_common')
      UNION ALL
      SELECT
        command_name,
        version,
        'pending',
        queue.name,
        queue.table_name,
        pgboss.job_table_format(command, queue.table_name)
      FROM pgboss.queue
      WHERE partition = true;
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE TABLE pgboss.job (
      id uuid not null default gen_random_uuid(),
      name text not null,
      priority integer not null default(0),
      data jsonb,
      state pgboss.job_state not null default 'created',
      retry_limit integer not null default 2,
      retry_count integer not null default 0,
      retry_delay integer not null default 0,
      retry_backoff boolean not null default false,
      retry_delay_max integer,
      expire_seconds int not null default 900,
      deletion_seconds int not null default 604800,
      singleton_key text,
      singleton_on timestamp without time zone,
      group_id text,
      group_tier text,
      start_after timestamp with time zone not null default now(),
      created_on timestamp with time zone not null default now(),
      started_on timestamp with time zone,
      completed_on timestamp with time zone,
      keep_until timestamp with time zone NOT NULL default now() + interval '1209600',
      output jsonb,
      dead_letter text,
      policy text,
      heartbeat_on timestamp with time zone,
      heartbeat_seconds int,
      blocked boolean not null default false,
      blocking boolean not null default false,
      pending_dependencies int not null default 0,
      source_name text,
      source_id uuid,
      source_created_on timestamp with time zone,
      source_retry_count int
    ) PARTITION BY LIST (name)
  ;
ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id);

    CREATE TABLE pgboss.job_common (LIKE pgboss.job INCLUDING GENERATED INCLUDING DEFAULTS);

    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id)$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i1 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i2 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i3 ON pgboss.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i6 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i8 ON pgboss.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE INDEX job_i10 ON pgboss.job (name, singleton_key, state DESC, created_on, id) INCLUDE (start_after) WHERE state < 'active' AND NOT blocked AND policy = 'key_strict_fifo'$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE UNIQUE INDEX job_i4 ON pgboss.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE INDEX job_i11 ON pgboss.job (name, priority DESC, created_on, start_after) WHERE state < 'active' AND NOT blocked$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE INDEX job_i7 ON pgboss.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, 'job_common');
    SELECT pgboss.job_table_run($cmd$CREATE INDEX job_i9 ON pgboss.job (name, id) WHERE blocking AND state = 'completed'$cmd$, 'job_common');

    ALTER TABLE pgboss.job ATTACH PARTITION pgboss.job_common DEFAULT;
  ;

    CREATE TABLE pgboss.warning (
      id uuid PRIMARY KEY default gen_random_uuid(),
      type text NOT NULL,
      message text NOT NULL,
      data jsonb,
      created_on timestamp with time zone NOT NULL DEFAULT now()
    )
  ;
CREATE INDEX warning_i1 ON pgboss.warning (created_on DESC);

    CREATE TABLE pgboss.queue_stats (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      name text NOT NULL,
      deferred_count int NOT NULL DEFAULT 0,
      queued_count   int NOT NULL DEFAULT 0,
      ready_count    int NOT NULL DEFAULT 0,
      active_count   int NOT NULL DEFAULT 0,
      failed_count   int NOT NULL DEFAULT 0,
      total_count    int NOT NULL DEFAULT 0,
      captured_on timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id, captured_on)
    ) PARTITION BY RANGE (captured_on)
  ;
CREATE INDEX queue_stats_i1 ON pgboss.queue_stats (name, captured_on DESC) INCLUDE (deferred_count, queued_count, ready_count, active_count, failed_count, total_count);

    DO $$
    DECLARE
      d date;
      i int;
      part_name text;
    BEGIN
      FOR i IN 0..1 LOOP
        d := (now() AT TIME ZONE 'UTC')::date + i;
        part_name := 'queue_stats_' || to_char(d, 'YYYYMMDD');
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'pgboss' AND c.relname = part_name
        ) THEN
          EXECUTE format(
            'CREATE TABLE pgboss.%I PARTITION OF pgboss.queue_stats FOR VALUES FROM (%L) TO (%L)',
            part_name,
            to_char(d, 'YYYY-MM-DD') || ' 00:00:00+00',
            to_char(d + 1, 'YYYY-MM-DD') || ' 00:00:00+00'
          );
        END IF;
      END LOOP;
    END;
    $$
  ;

    CREATE TABLE pgboss.job_dependency (
      child_name text NOT NULL,
      child_id uuid NOT NULL,
      parent_name text NOT NULL,
      parent_id uuid NOT NULL,
      PRIMARY KEY (child_name, child_id, parent_name, parent_id)
    )
  ;
CREATE INDEX IF NOT EXISTS job_dep_parent_idx ON pgboss.job_dependency (parent_name, parent_id);

    CREATE FUNCTION pgboss.create_queue(queue_name text, options jsonb)
    RETURNS VOID AS
    $$
    DECLARE
      tablename varchar := CASE WHEN options->>'partition' = 'true'
                            THEN 'j' || encode(sha224(queue_name::bytea), 'hex')
                            ELSE 'job_common'
                            END;
      queue_created_on timestamptz;
    BEGIN

      WITH q as (
        INSERT INTO pgboss.queue (
          name,
          policy,
          retry_limit,
          retry_delay,
          retry_backoff,
          retry_delay_max,
          expire_seconds,
          retention_seconds,
          deletion_seconds,
          warning_queued,
          dead_letter,
          partition,
          table_name,
          heartbeat_seconds,
          notify
        )
        VALUES (
          queue_name,
          options->>'policy',
          COALESCE((options->>'retryLimit')::int, 2),
          COALESCE((options->>'retryDelay')::int, 0),
          COALESCE((options->>'retryBackoff')::bool, false),
          (options->>'retryDelayMax')::int,
          COALESCE((options->>'expireInSeconds')::int, 900),
          COALESCE((options->>'retentionSeconds')::int, 1209600),
          COALESCE((options->>'deleteAfterSeconds')::int, 604800),
          COALESCE((options->>'warningQueueSize')::int, 0),
          options->>'deadLetter',
          COALESCE((options->>'partition')::bool, false),
          tablename,
          (options->>'heartbeatSeconds')::int,
          COALESCE((options->>'notify')::bool, false)
        )
        ON CONFLICT DO NOTHING
        RETURNING created_on
      )
      SELECT created_on into queue_created_on from q;

      IF queue_created_on IS NULL OR options->>'partition' IS DISTINCT FROM 'true' THEN
        RETURN;
      END IF;

      EXECUTE format('CREATE TABLE pgboss.%I (LIKE pgboss.job INCLUDING DEFAULTS)', tablename);

      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id)$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);

      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i11 ON pgboss.job (name, priority DESC, created_on, start_after) WHERE state < 'active' AND NOT blocked$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i4 ON pgboss.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i7 ON pgboss.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i9 ON pgboss.job (name, id) WHERE blocking AND state = 'completed'$cmd$, tablename);

      IF options->>'policy' = 'short' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i1 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, tablename);
      ELSIF options->>'policy' = 'singleton' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i2 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, tablename);
      ELSIF options->>'policy' = 'stately' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i3 ON pgboss.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, tablename);
      ELSIF options->>'policy' = 'exclusive' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i6 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, tablename);
      ELSIF options->>'policy' = 'key_strict_fifo' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i8 ON pgboss.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, tablename);
        EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i10 ON pgboss.job (name, singleton_key, state DESC, created_on, id) INCLUDE (start_after) WHERE state < 'active' AND NOT blocked AND policy = 'key_strict_fifo'$cmd$, tablename);
        EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, tablename);
      END IF;

      EXECUTE format('ALTER TABLE pgboss.%I ADD CONSTRAINT cjc CHECK (name=%L)', tablename, queue_name);
      EXECUTE format('ALTER TABLE pgboss.job ATTACH PARTITION pgboss.%I FOR VALUES IN (%L)', tablename, queue_name);
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE FUNCTION pgboss.delete_queue(queue_name text)
    RETURNS VOID AS
    $$
    DECLARE
      v_table varchar;
      v_partition bool;
    BEGIN

      SELECT table_name, partition
      FROM pgboss.queue
      WHERE name = queue_name
      INTO v_table, v_partition;

      IF v_partition THEN
        EXECUTE format('DROP TABLE IF EXISTS pgboss.%I', v_table);
      ELSE
        EXECUTE format('DELETE FROM pgboss.%I WHERE name = %L', v_table, queue_name);
      END IF;

      DELETE FROM pgboss.queue WHERE name = queue_name;
    END;
    $$
    LANGUAGE plpgsql;
  ;
INSERT INTO pgboss.version(version) VALUES ('40');

-- ## Grants
--
-- `ALL TABLES`/`ALL FUNCTIONS IN SCHEMA`, not one GRANT per object the way
-- every other migration in this directory does it (see
-- `20260919000002_ledger.sql`, `20260920000013_watch_session.sql`): every
-- other migration owns the object list it grants on, because we wrote every
-- table in it. This schema's object list is pg-boss's to define and it can
-- change between versions in ways this migration does not control, so
-- naming each table individually here would silently under-grant the day a
-- future `getConstructionPlans` output adds one. There are no SEQUENCEs to
-- grant: every id column above defaults from `gen_random_uuid()`.
--
-- `yourtal_app` gets no CREATE on this schema, deliberately, and that is
-- provably enough for how `packages/queue` uses pg-boss — see the "app role
-- never issues DDL" note in `packages/queue/src/client.ts`:
--   * `migrate: false` / `createSchema: false` — the client only ever
--     CHECKs the schema, never creates or migrates it.
--   * `persistQueueStats: false` — pg-boss's own daily `queue_stats`
--     partition maintenance (`ensureQueueStatsPartitions`) is CREATE TABLE
--     under whichever role calls `supervise()`, i.e. this one. Queue depth,
--     retry counts and dead-lettered jobs are all readable straight off
--     `pgboss.job`/`pgboss.queue` (see `packages/queue/src/observability.ts`),
--     so this repo has no use for that aggregate table yet and turns it off
--     rather than let a maintenance tick fail on a permission error.
--   * every queue this repo defines passes `partition: false` (the
--     default) — `pgboss.create_queue()`'s CREATE TABLE branch only runs
--     when `partition: true`, and turning that on for a queue is a decision
--     for whoever needs the extra scale, made explicitly, because it would
--     require the app role to run DDL that this migration does not grant.
GRANT USAGE ON SCHEMA pgboss TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO yourtal_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO yourtal_app;
