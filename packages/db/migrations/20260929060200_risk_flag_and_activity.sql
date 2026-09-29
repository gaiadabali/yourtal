-- TASKS.md 10.4: the real RiskGate's manual-review queue (10.4.b) and the
-- clock points expiry (10.2.a) reads. Both live in the `ledger` schema --
-- yourtal_app has no grant on it at all (infra/postgres/init/01-schemas.sql,
-- the same wall dev_holdback.go's own comment describes), so the staff
-- console reaches this table only through the ledger's own HTTP routes,
-- exactly like escrow and every other ledger-owned table.

CREATE TABLE ledger.risk_flag (
  id              text        PRIMARY KEY,
  user_id         text        NOT NULL,
  region          text        NOT NULL CHECK (region IN ('AU', 'ID')),
  -- 'flag': written for staff to see, the grant that raised it still went
  -- through. 'block': the grant that raised it was refused AND the
  -- account's current balance was auto-held into escrow (escrow_id below)
  -- until a human looks at it (10.4.d).
  severity        text        NOT NULL CHECK (severity IN ('flag', 'block')),
  reason          text        NOT NULL CHECK (reason <> ''),
  signals         jsonb       NOT NULL,
  escrow_id       text        REFERENCES ledger.escrow (id),
  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'released', 'suspended')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text,
  CHECK ((status = 'pending') = (resolved_at IS NULL))
);

CREATE INDEX risk_flag_queue_idx ON ledger.risk_flag (region, status, created_at DESC);
CREATE INDEX risk_flag_user_idx ON ledger.risk_flag (user_id);

CREATE TRIGGER risk_flag_stamp_now BEFORE INSERT ON ledger.risk_flag
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();

GRANT SELECT, INSERT, UPDATE ON ledger.risk_flag TO yourtal_ledger;
REVOKE DELETE ON ledger.risk_flag FROM yourtal_ledger;
REVOKE ALL ON ledger.risk_flag FROM yourtal_app;

-- 10.2.a: written inside every grant and burn transaction. Defaulted to
-- now() rather than left null, so an account that predates this migration
-- reads as active today instead of looking instantly overdue for expiry.
ALTER TABLE ledger.account ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX account_activity_idx ON ledger.account (country, purpose, last_activity_at)
  WHERE owner_type = 'user';

-- ledger.account is otherwise SELECT/INSERT only for yourtal_ledger
-- (20260919000002: a balance is projected from entries, never stored, so
-- nothing about an account row is meant to change after it is created).
-- This one column is the deliberate exception -- an UPDATE grant scoped to
-- it alone, so a bug elsewhere in this service still cannot rewrite an
-- account's owner, currency or country.
GRANT UPDATE (last_activity_at) ON ledger.account TO yourtal_ledger;

-- 10.2.d: mirrors ledger.release_notice's own unnotified/notified shape
-- (20260926003000) for the same reason -- apps/worker polls a durable outbox
-- rather than the ledger pushing anything. One row per (account, milestone):
-- an account gets at most one 30-day and one 7-day notice for a given
-- expiry date, and a fresh expiry date (activity reset the clock) is a new
-- row, not an update of the old one.
CREATE TABLE ledger.points_expiry_notice (
  account_id     text        NOT NULL REFERENCES ledger.account (id),
  milestone_days integer     NOT NULL CHECK (milestone_days IN (30, 7)),
  expiring_at    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  notified_at    timestamptz,
  PRIMARY KEY (account_id, milestone_days, expiring_at)
);

CREATE INDEX points_expiry_notice_unnotified_idx ON ledger.points_expiry_notice (created_at)
  WHERE notified_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON ledger.points_expiry_notice TO yourtal_ledger;
REVOKE DELETE ON ledger.points_expiry_notice FROM yourtal_ledger;
REVOKE ALL ON ledger.points_expiry_notice FROM yourtal_app;
