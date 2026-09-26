-- TASKS.md 2.3.d: `/dev/clock`'s audit trail. Every action a reviewer takes
-- on that page (release my pending points, run a scheduled job, advance my
-- account by N days) writes one row here, append-only -- there is no UPDATE
-- or DELETE grant, matching `ledger.release_notice`'s own "a row means it
-- happened" convention. Lives in `platform`, not `ledger`, because this is
-- reviewer tooling, not a ledger fact -- the same reasoning
-- `ledger_voucher_fake_tables.sql` gives for keeping FakeLedgerClient's own
-- state out of the `ledger` schema.
CREATE TABLE platform.dev_clock_audit (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL,
  action     text        NOT NULL CHECK (
               action IN ('release_pending', 'run_job', 'advance_days')
             ),
  detail     jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dev_clock_audit_user_idx ON platform.dev_clock_audit (user_id, created_at);

-- Append-only: `yourtal_app` may read and write new rows, never change or
-- remove one it already wrote.
GRANT SELECT, INSERT ON platform.dev_clock_audit TO yourtal_app;
