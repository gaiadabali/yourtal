-- 4.6.f.2: the ledger's record of each voucher capture it posted, keyed by
-- the voucher service's capture_id so a retry replays instead of posting
-- twice. ledger.transfer's idempotency key refuses the same capture_id with
-- different terms (idempotency_conflict).
CREATE TABLE ledger.capture (
  capture_id   text        PRIMARY KEY,
  region       text        NOT NULL CHECK (region IN ('AU', 'ID')),
  merchant_id  text        NOT NULL,
  amount_minor bigint      NOT NULL CHECK (amount_minor > 0),
  currency     char(3)     NOT NULL,
  transfer_id  text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((region = 'AU' AND currency = 'AUD') OR (region = 'ID' AND currency = 'IDR'))
);

CREATE TRIGGER capture_stamp_now BEFORE INSERT ON ledger.capture
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();

GRANT SELECT, INSERT ON ledger.capture TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.capture FROM yourtal_ledger;
REVOKE ALL ON ledger.capture FROM yourtal_app;

-- FakeLedgerClient's store (1.2.d), same convention as ledger_fake_burn.
CREATE TABLE platform.ledger_fake_capture (
  capture_id   text        PRIMARY KEY,
  region       text        NOT NULL,
  merchant_id  uuid        NOT NULL,
  amount_minor bigint      NOT NULL,
  currency     text        NOT NULL,
  transfer_id  text        NOT NULL,
  posted_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.ledger_fake_capture TO yourtal_app;

-- The outbox is drained by services/voucher itself, not apps/worker: the
-- outbox lives in the voucher schema, so the voucher role marks rows posted
-- and yourtal_app loses the write it was given for a worker that never came.
GRANT UPDATE (posted_at) ON voucher.capture_outbox TO yourtal_voucher;
REVOKE UPDATE ON voucher.capture_outbox FROM yourtal_app;
