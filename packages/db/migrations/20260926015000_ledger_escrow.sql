-- 4.4.g / 9.4.b: escrow freezes a user's points without zeroing them.
-- Points come from available first, then pending; the split is recorded so
-- the release puts each part back where it came from. Append-only: a
-- release is its own row, never an edit of the escrow.
CREATE TABLE ledger.escrow (
  id               text        PRIMARY KEY,
  idempotency_key  text        NOT NULL UNIQUE,
  user_id          text        NOT NULL,
  region           text        NOT NULL CHECK (region IN ('AU', 'ID')),
  points           bigint      NOT NULL CHECK (points > 0),
  available_points bigint      NOT NULL CHECK (available_points >= 0),
  pending_points   bigint      NOT NULL CHECK (pending_points >= 0),
  reason           text        NOT NULL CHECK (reason <> ''),
  transfer_id      text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (available_points + pending_points = points)
);

CREATE INDEX escrow_user_idx ON ledger.escrow (user_id);

CREATE TABLE ledger.escrow_release (
  escrow_id   text        PRIMARY KEY REFERENCES ledger.escrow (id),
  transfer_id text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER escrow_stamp_now BEFORE INSERT ON ledger.escrow
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();
CREATE TRIGGER escrow_release_stamp_now BEFORE INSERT ON ledger.escrow_release
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();

GRANT SELECT, INSERT ON ledger.escrow, ledger.escrow_release TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.escrow, ledger.escrow_release FROM yourtal_ledger;
REVOKE ALL ON ledger.escrow, ledger.escrow_release FROM yourtal_app;

-- The FakeLedgerClient mirrors the same split and freeze: how much of a held
-- escrow came from pending, and when it began (releases pause from then).
ALTER TABLE platform.ledger_fake_escrow
  ADD COLUMN pending_points bigint      NOT NULL DEFAULT 0 CHECK (pending_points >= 0),
  ADD COLUMN created_at     timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT ledger_fake_escrow_pending_within CHECK (pending_points <= points);
