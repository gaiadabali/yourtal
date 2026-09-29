-- TASKS.md 10.2.b: the voucher expiry sweep posts the remaining liability
-- release to the ledger the same in-process way `voucher.capture_outbox`
-- does (20260926120000's own corrected grants: yourtal_voucher writes AND
-- drains this table itself; yourtal_app never touches it, there being no
-- TS worker job in this path).
CREATE TABLE voucher.expiry_outbox (
  voucher_id   uuid        PRIMARY KEY REFERENCES voucher.vouchers (id),
  region       text        NOT NULL CHECK (region IN ('AU', 'ID')),
  amount_minor bigint      NOT NULL CHECK (amount_minor >= 0),
  currency     char(3)     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  posted_at    timestamptz
);

CREATE INDEX expiry_outbox_unposted_idx ON voucher.expiry_outbox (created_at) WHERE posted_at IS NULL;

GRANT SELECT, INSERT ON voucher.expiry_outbox TO yourtal_voucher;
GRANT UPDATE (posted_at) ON voucher.expiry_outbox TO yourtal_voucher;
