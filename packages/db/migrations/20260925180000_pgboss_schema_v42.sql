-- YT-0040 follow-up (0.8.f): pg-boss bumped 12.30.0 -> 12.34.0, whose
-- internal schema version moved 40 -> 42. `packages/queue/src/client.ts`
-- runs with `migrate: false`, so `Contractor.check()` refuses to start
-- against a schema at the wrong version — this migration is what brings
-- the schema installed by 20260921234000_pgboss_schema.sql to 42.
--
-- Same reasoning as that file's header: this is the verbatim output of
-- `getMigrationPlans('pgboss', 40)` from the pinned pg-boss@12.34.0, with
-- only its own `BEGIN`/`COMMIT` stripped (Atlas already wraps this file in
-- its own transaction); the `SET LOCAL`/advisory-lock statements are kept
-- verbatim since they are ordinary statements, not transaction control. A
-- future pg-boss bump that changes the schema version again gets its own
-- new migration the same way — this file is never edited once merged.
    SET LOCAL lock_timeout = 30000;
    SET LOCAL idle_in_transaction_session_timeout = 30000;
    SELECT pg_advisory_xact_lock(('x' || encode(sha224((current_database() || '.pgboss.pgboss')::bytea), 'hex'))::bit(64)::bigint);
SELECT version::int/(version::int-42) from pgboss.version;
ALTER TABLE pgboss.schedule ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'cron' CHECK (kind IN ('cron', 'rrule'));
UPDATE pgboss.schedule SET kind = 'rrule'
              WHERE kind = 'cron'
                AND (cron ~* '(^|[[:space:]]|;)FREQ=' OR cron ~* '(^|[[:space:]])(DTSTART|RRULE|RDATE|EXDATE)[;:]');
UPDATE pgboss.schedule SET timezone = 'UTC' WHERE timezone IS NULL;
ALTER TABLE pgboss.schedule ALTER COLUMN timezone SET DEFAULT 'UTC';
ALTER TABLE pgboss.schedule ADD COLUMN IF NOT EXISTS last_job_id uuid;
CREATE OR REPLACE FUNCTION pgboss.job_now()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
AS $function$
      SELECT pg_catalog.now();
    $function$
;

    CREATE OR REPLACE FUNCTION pgboss.create_queue(queue_name text, options jsonb)
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
    notify,
    created_on,
    updated_on
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
    COALESCE((options->>'notify')::bool, false),
    pgboss.job_now(),
    pgboss.job_now()
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
UPDATE pgboss.version SET version = '42';
