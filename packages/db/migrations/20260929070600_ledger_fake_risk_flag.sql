-- TASKS.md 10.5: the fake ledger's own mirror of `ledger.risk_flag`
-- (20260929060200, the real Go service's table apps/api cannot read
-- directly). LEDGER_MODE=fake never runs the real RiskGate — a fake grant
-- never flags anything on its own — so this table exists to be SEEDED
-- directly by a staff-console test, the same "own narrow SQL, never edit
-- the identity module" shape platform.ledger_fake_escrow already follows.
CREATE TABLE platform.ledger_fake_risk_flag (
  id              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         uuid        NOT NULL,
  region          text        NOT NULL CHECK (region IN ('AU', 'ID')),
  severity        text        NOT NULL CHECK (severity IN ('flag', 'block')),
  reason          text        NOT NULL,
  signals         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  escrow_id       text        REFERENCES platform.ledger_fake_escrow (id),
  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'released', 'suspended')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text
);

CREATE INDEX ledger_fake_risk_flag_queue_idx ON platform.ledger_fake_risk_flag (region, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON platform.ledger_fake_risk_flag TO yourtal_app;
