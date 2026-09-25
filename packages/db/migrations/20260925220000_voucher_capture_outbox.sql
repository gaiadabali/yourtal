-- 4.6.f: every capture writes an outbox row here, in the SAME transaction as
-- the capture itself — an outbox row with no capture, or a capture with no
-- outbox row, would each be a way for the ledger to never learn a merchant
-- was paid. A worker job (apps/worker/src/jobs, 10.1) posts unposted rows to
-- the ledger with idempotency key = capture_id; `posted_at` is that job's
-- own marker, set only after the ledger confirms.
--
-- The posting itself needs a ledger-internal route this migration does not
-- add (services/ledger is agent A's) — see TASKS.md 4.6.f's "(requested by
-- B)" note. This table and the write into it from every capture path stand
-- on their own regardless of when that route lands.
CREATE TABLE voucher.capture_outbox (
  capture_id   uuid        PRIMARY KEY REFERENCES voucher.capture (id),
  region       text        NOT NULL CHECK (region IN ('AU', 'ID')),
  merchant_id  uuid        NOT NULL,
  amount_minor bigint      NOT NULL CHECK (amount_minor > 0),
  currency     char(3)     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  posted_at    timestamptz
);

CREATE INDEX capture_outbox_unposted_idx ON voucher.capture_outbox (created_at) WHERE posted_at IS NULL;

-- The Go service writes one row per capture, inside the capture's own
-- transaction.
GRANT SELECT, INSERT ON voucher.capture_outbox TO yourtal_voucher;

-- apps/worker reads unposted rows and marks them posted after the ledger
-- confirms. No DELETE: the outbox is also the audit trail of what was
-- posted and when.
GRANT SELECT, UPDATE ON voucher.capture_outbox TO yourtal_app;
