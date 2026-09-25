-- 4.3.e: a burn turns points into a voucher obligation exactly once per
-- checkout saga, and K13's reinstatement undoes it exactly once.

CREATE TABLE ledger.burn (
  saga_id               text        PRIMARY KEY,
  user_id               text        NOT NULL,
  region                text        NOT NULL CHECK (region IN ('AU', 'ID')),
  points                bigint      NOT NULL CHECK (points > 0),
  settlement_minor      bigint      NOT NULL CHECK (settlement_minor > 0),
  points_transfer_id    text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  liability_transfer_id text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Append-only: a reinstatement is its own row, never an edit of the burn.
CREATE TABLE ledger.burn_reinstatement (
  saga_id               text        PRIMARY KEY REFERENCES ledger.burn (saga_id),
  points_transfer_id    text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  liability_transfer_id text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  reason                text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER burn_stamp_now BEFORE INSERT ON ledger.burn
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();
CREATE TRIGGER burn_reinstatement_stamp_now BEFORE INSERT ON ledger.burn_reinstatement
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();

GRANT SELECT, INSERT ON ledger.burn, ledger.burn_reinstatement TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.burn, ledger.burn_reinstatement FROM yourtal_ledger;
REVOKE ALL ON ledger.burn, ledger.burn_reinstatement FROM yourtal_app;
