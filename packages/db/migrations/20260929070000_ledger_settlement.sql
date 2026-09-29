-- 10.1: clearing & settlement. Two new ledger-owned tables.
--
-- `ledger.statement` is the weekly reconciliation per business per region
-- (10.1.b): opening payable + captures - refunds - recoveries = closing
-- payable (the amount owed). It is a snapshot computed from `ledger.entry`
-- at generation time, not a live view, so a disputed or approved statement
-- reads the same later even as new activity keeps posting. Point purchases
-- are their own columns, informational only, never folded into the payable
-- figures above (J1).
--
-- `ledger.capture_recovery` is 10.5.b's K13 recovery line: staff resolving a
-- captured-voucher dispute reverses a share of that capture against the
-- merchant, keyed on the capture so the same dispute cannot be posted twice.
CREATE TABLE ledger.statement (
  id                     text        PRIMARY KEY,
  business_id            text        NOT NULL,
  region                 text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency               char(3)     NOT NULL,
  period_from            timestamptz NOT NULL,
  period_to              timestamptz NOT NULL, -- exclusive
  opening_payable_minor  bigint      NOT NULL,
  captures_minor         bigint      NOT NULL CHECK (captures_minor >= 0),
  refunds_minor          bigint      NOT NULL CHECK (refunds_minor >= 0),
  recoveries_minor       bigint      NOT NULL CHECK (recoveries_minor >= 0),
  closing_payable_minor  bigint      NOT NULL,
  point_purchases_minor  bigint      NOT NULL DEFAULT 0,
  point_purchases_points bigint      NOT NULL DEFAULT 0,
  status                 text        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'disputed', 'paid')),
  dispute_reason         text,
  disputed_at            timestamptz,
  resolution_note        text,
  resolved_at            timestamptz,
  dispute_window_ends_at timestamptz NOT NULL,
  generated_at           timestamptz NOT NULL DEFAULT now(),
  approved_by            text,
  approved_at            timestamptz,
  payout_transfer_id     text REFERENCES ledger.transfer (id),
  CHECK ((region = 'AU' AND currency = 'AUD') OR (region = 'ID' AND currency = 'IDR')),
  CHECK (period_to > period_from),
  CHECK ((status = 'paid') = (approved_by IS NOT NULL)),
  CHECK ((status = 'disputed') = (disputed_at IS NOT NULL AND resolved_at IS NULL)),
  UNIQUE (business_id, region, period_from, period_to)
);

CREATE INDEX statement_business_idx ON ledger.statement (business_id, region, period_from DESC);
CREATE INDEX statement_status_idx ON ledger.statement (status) WHERE status IN ('open', 'disputed');

GRANT SELECT, INSERT ON ledger.statement TO yourtal_ledger;
GRANT UPDATE (status, dispute_reason, disputed_at, resolution_note, resolved_at, approved_by, approved_at, payout_transfer_id)
  ON ledger.statement TO yourtal_ledger;
REVOKE DELETE ON ledger.statement FROM yourtal_ledger;
REVOKE ALL ON ledger.statement FROM yourtal_app;

CREATE TABLE ledger.capture_recovery (
  id           text        PRIMARY KEY,
  capture_id   text        NOT NULL UNIQUE REFERENCES ledger.capture (capture_id),
  region       text        NOT NULL CHECK (region IN ('AU', 'ID')),
  merchant_id  text        NOT NULL,
  amount_minor bigint      NOT NULL CHECK (amount_minor > 0),
  currency     char(3)     NOT NULL,
  reason       text        NOT NULL,
  transfer_id  text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((region = 'AU' AND currency = 'AUD') OR (region = 'ID' AND currency = 'IDR'))
);

GRANT SELECT, INSERT ON ledger.capture_recovery TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.capture_recovery FROM yourtal_ledger;
REVOKE ALL ON ledger.capture_recovery FROM yourtal_app;

-- FakeLedgerClient's store (1.2.d), same convention as ledger_fake_capture:
-- illustrative arithmetic against these tables, not the real double-entry
-- books above, for LEDGER_MODE=fake (this repo's dev/test default).
CREATE TABLE platform.ledger_fake_statement (
  id                     text        PRIMARY KEY,
  business_id            uuid        NOT NULL,
  region                 text        NOT NULL,
  currency               text        NOT NULL,
  period_from            timestamptz NOT NULL,
  period_to              timestamptz NOT NULL,
  opening_payable_minor  bigint      NOT NULL,
  captures_minor         bigint      NOT NULL,
  refunds_minor          bigint      NOT NULL,
  recoveries_minor       bigint      NOT NULL,
  closing_payable_minor  bigint      NOT NULL,
  point_purchases_minor  bigint      NOT NULL DEFAULT 0,
  point_purchases_points bigint      NOT NULL DEFAULT 0,
  status                 text        NOT NULL DEFAULT 'open',
  dispute_reason         text,
  disputed_at            timestamptz,
  resolution_note        text,
  resolved_at            timestamptz,
  dispute_window_ends_at timestamptz NOT NULL,
  generated_at           timestamptz NOT NULL DEFAULT now(),
  approved_by            text,
  approved_at            timestamptz,
  payout_transfer_id     text,
  UNIQUE (business_id, region, period_from, period_to)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.ledger_fake_statement TO yourtal_app;

CREATE TABLE platform.ledger_fake_capture_recovery (
  id           text        PRIMARY KEY,
  capture_id   text        NOT NULL UNIQUE REFERENCES platform.ledger_fake_capture (capture_id),
  region       text        NOT NULL,
  merchant_id  uuid        NOT NULL,
  amount_minor bigint      NOT NULL,
  currency     text        NOT NULL,
  reason       text        NOT NULL,
  transfer_id  text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.ledger_fake_capture_recovery TO yourtal_app;

-- FakeLedgerClient's store for releaseVoucherLiability: idempotency only —
-- the fake does not model a full voucher_liability balance.
CREATE TABLE platform.ledger_fake_liability_release (
  idempotency_key text        PRIMARY KEY,
  region          text        NOT NULL,
  amount_minor    bigint      NOT NULL,
  transfer_id     text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.ledger_fake_liability_release TO yourtal_app;
