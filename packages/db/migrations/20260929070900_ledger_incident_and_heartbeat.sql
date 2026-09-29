-- 10.3.c: a simulated pager (CLAUDE.md: everything external is a simulated
-- driver) and the "hasn't run" check for every scheduled job.
--
-- `ledger.incident` is what a real pager would have sent -- observable and
-- queryable instead of only a log line, which is why `LoggingAlerter`
-- (proof/alerter.go) was named for what it is rather than `DefaultAlerter`:
-- a page that "merely logs" is not the real thing (YT-0044's own acceptance
-- criterion).
CREATE TABLE ledger.incident (
  id        bigserial   PRIMARY KEY,
  summary   text        NOT NULL,
  detail    text        NOT NULL,
  raised_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON ledger.incident TO yourtal_ledger;
GRANT USAGE ON SEQUENCE ledger.incident_id_seq TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.incident FROM yourtal_ledger;

-- One row per scheduled job (the daily proof, the invariant checker, the
-- repricer, …): the job itself touches its own row every tick, and a
-- "hasn't run" check pages when `last_run_at` is older than its own
-- `interval_seconds` allows for.
CREATE TABLE ledger.job_heartbeat (
  job_name        text        PRIMARY KEY,
  last_run_at     timestamptz NOT NULL DEFAULT now(),
  interval_seconds bigint     NOT NULL CHECK (interval_seconds > 0)
);

GRANT SELECT, INSERT, UPDATE ON ledger.job_heartbeat TO yourtal_ledger;
REVOKE DELETE ON ledger.job_heartbeat FROM yourtal_ledger;
