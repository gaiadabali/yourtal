-- YT-0518 / YT-0041: the ledger, with its invariants enforced by Postgres.
--
-- docs/02 section 68: double-entry, append-only, sole writer of all balances.
-- docs/13 section 4 puts "double-entry balance, append-only enforcement,
-- idempotency replay" on the must-have-tests list. The point of this
-- migration is that those are DATABASE constraints, not service conventions:
-- a service with a bug, or a psql session with the ledger credential, must be
-- unable to write an unbalanced transfer.
--
-- MONEY UNIT: amounts are int64 minor units plus an explicit currency, per
-- docs/12 section 3's Money pattern. This deliberately does NOT settle
-- YT-0506 (whether IDR minor units are sen or Rupiah) — that question is
-- about which integer a given amount is, not about the column type, and it
-- stays blocked pending confirmation of what Xendit accepts. bigint is
-- correct under either answer.

CREATE TABLE ledger.account (
  id          text        PRIMARY KEY,
  owner_type  text        NOT NULL CHECK (owner_type IN ('user', 'merchant', 'platform', 'escrow', 'charity')),
  owner_id    text        NOT NULL,
  currency    char(3)     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_owner_unique UNIQUE (owner_type, owner_id, currency)
);

CREATE TABLE ledger.transfer (
  id               text        PRIMARY KEY,
  -- docs/02 line 225. The whole retry story rests on this one constraint:
  -- a replayed transfer cannot create a second movement of value.
  idempotency_key  text        NOT NULL UNIQUE,
  reason_code      text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.entry (
  id            bigserial   PRIMARY KEY,
  transfer_id   text        NOT NULL REFERENCES ledger.transfer (id),
  account_id    text        NOT NULL REFERENCES ledger.account (id),
  -- Signed: debits negative, credits positive. Summing to zero is what makes
  -- it double-entry.
  amount_minor  bigint      NOT NULL,
  currency      char(3)     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entry_amount_nonzero CHECK (amount_minor <> 0)
);

CREATE INDEX entry_transfer_idx ON ledger.entry (transfer_id);
CREATE INDEX entry_account_idx  ON ledger.entry (account_id);

-- The balance invariant.
--
-- It cannot be a CHECK: a CHECK sees one row, and "these rows sum to zero" is
-- a statement about a set. It cannot be checked per-statement either, because
-- a transfer is legitimately built from several INSERTs. So it is a DEFERRED
-- constraint trigger that fires once at COMMIT, by which time the whole
-- transfer exists and is either balanced or is not.
--
-- Deferring is the point: it is what allows the invariant to be absolute
-- rather than "absolute except while we are mid-write".
CREATE OR REPLACE FUNCTION ledger.assert_transfer_balanced() RETURNS trigger AS $$
DECLARE
  imbalance bigint;
  entries   integer;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0), COUNT(*)
    INTO imbalance, entries
    FROM ledger.entry
   WHERE transfer_id = NEW.transfer_id;

  IF entries < 2 THEN
    RAISE EXCEPTION 'ledger: transfer % has % entries; double-entry needs at least 2',
      NEW.transfer_id, entries
      USING ERRCODE = 'check_violation';
  END IF;

  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'ledger: transfer % is unbalanced by %', NEW.transfer_id, imbalance
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM ledger.entry WHERE transfer_id = NEW.transfer_id
              GROUP BY currency HAVING COUNT(*) > 0 OFFSET 1) THEN
    RAISE EXCEPTION 'ledger: transfer % mixes currencies', NEW.transfer_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER entry_balances_at_commit
  AFTER INSERT ON ledger.entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_transfer_balanced();

-- Append-only, enforced by grant rather than by convention.
-- docs/14 section 8: "the ledger role holds no UPDATE or DELETE on transfer".
-- Extended to entry and account for the same reason — a ledger you can edit
-- is a spreadsheet.
GRANT USAGE ON SCHEMA ledger TO yourtal_ledger;
GRANT SELECT, INSERT ON ledger.account, ledger.transfer, ledger.entry TO yourtal_ledger;
GRANT USAGE, SELECT ON SEQUENCE ledger.entry_id_seq TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.account, ledger.transfer, ledger.entry FROM yourtal_ledger;

-- The app role cannot see the ledger at all; it asks the ledger service.
REVOKE ALL ON ALL TABLES IN SCHEMA ledger FROM yourtal_app;
