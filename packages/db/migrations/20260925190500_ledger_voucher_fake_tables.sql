-- TASKS.md 1.2.d/1.2.b: storage for the ledger-internal and voucher-internal
-- FAKE clients, so apps/api and apps/worker share one view of fake state
-- instead of each process inventing its own in-memory copy. Lives in
-- `platform` (docs/15: not `ledger` or `voucher`, which are the REAL
-- services' schemas once Phase 4/4.5 build them) so `yourtal_app` can own it
-- outright, the same way it already owns `platform.idempotency`.
--
-- This is scaffolding for FakeLedgerClient/FakeVoucherClient, not the real
-- double-entry ledger (that is `ledger.account`/`ledger.entry`, Phase 4) or
-- the real voucher service's own Postgres (`services/voucher`, a separate
-- database entirely). Real money-safety invariants (two-person approval,
-- exact-inverse reversals) are simulated well enough for B and C to build
-- against, not re-proven here.

-- ---------------------------------------------------------------------------
-- ledger-internal fake state
-- ---------------------------------------------------------------------------

CREATE TABLE platform.ledger_fake_allocation (
  id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id      uuid        NOT NULL,
  region           text        NOT NULL CHECK (region IN ('AU', 'ID')),
  funder_type      text        NOT NULL CHECK (funder_type IN ('partner', 'marketing')),
  currency         text        NOT NULL,
  total_points     bigint      NOT NULL CHECK (total_points >= 0),
  remaining_points bigint      NOT NULL CHECK (remaining_points >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ledger_fake_allocation_remaining_within_total CHECK (remaining_points <= total_points)
);

CREATE TABLE platform.ledger_fake_hold (
  id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  allocation_id text        NOT NULL REFERENCES platform.ledger_fake_allocation (id),
  points        bigint      NOT NULL CHECK (points > 0),
  saga_id       text        NOT NULL UNIQUE,
  state         text        NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'consumed', 'released')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Every grant this user has ever received. `unlock_at <= now()` is what
-- makes a grant available; there is no separate job that flips a state
-- column, the same "derive, do not store a second copy" rule the rest of
-- this codebase follows for status.
CREATE TABLE platform.ledger_fake_grant (
  id              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind            text        NOT NULL CHECK (kind IN ('campaign', 'streak', 'receipt', 'goodwill')),
  user_id         uuid        NOT NULL,
  region          text        NOT NULL CHECK (region IN ('AU', 'ID')),
  points          bigint      NOT NULL CHECK (points >= 0),
  unlock_at       timestamptz NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  idempotency_key text        NOT NULL UNIQUE,
  -- `returnGrant`: a clawed-back grant stops counting toward balance/history
  -- but the row stays, for audit.
  reversed        boolean     NOT NULL DEFAULT false,
  -- Only set for kind = 'campaign' -- what `campaignSpend` aggregates over,
  -- and which allocation the points were drawn from.
  campaign_id     uuid,
  allocation_id   text        REFERENCES platform.ledger_fake_allocation (id),

  CONSTRAINT ledger_fake_grant_campaign_iff_kind CHECK ((kind = 'campaign') = (campaign_id IS NOT NULL))
);

CREATE INDEX ledger_fake_grant_user_idx ON platform.ledger_fake_grant (user_id);

-- A burn debits available points in aggregate -- it does not draw down any
-- one grant row, matching how `burnForVoucher` is specified (draws from
-- available, not from a named grant). `reinstateBurn` (K13) flips the state
-- rather than deleting the row, so the saga stays auditable.
CREATE TABLE platform.ledger_fake_burn (
  saga_id    text        PRIMARY KEY,
  user_id    uuid        NOT NULL,
  listing_id uuid        NOT NULL,
  points     bigint      NOT NULL CHECK (points > 0),
  state      text        NOT NULL DEFAULT 'burned' CHECK (state IN ('burned', 'reinstated')),
  burned_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_fake_burn_user_idx ON platform.ledger_fake_burn (user_id);

CREATE TABLE platform.ledger_fake_escrow (
  id       text   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id  uuid   NOT NULL,
  points   bigint NOT NULL CHECK (points > 0),
  reason   text   NOT NULL,
  state    text   NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'released'))
);

CREATE INDEX ledger_fake_escrow_user_idx ON platform.ledger_fake_escrow (user_id);

-- One row per region: the backing rate currently in force. `approveRate`
-- inserts a new row rather than updating one, so `quote` can always ask for
-- the rate that was in force AT A GIVEN INSTANT (services/ledger's real
-- `RateAt` does the same for the same reason: a caller must not be able to
-- backdate a quote to dodge a rate change).
CREATE TABLE platform.ledger_fake_backing_rate (
  id                          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  region                      text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency                    text        NOT NULL,
  backing_rate_micros_per_pt  bigint      NOT NULL CHECK (backing_rate_micros_per_pt > 0),
  effective_from              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_fake_backing_rate_region_idx
  ON platform.ledger_fake_backing_rate (region, effective_from DESC);

-- F1: AU B = 3 cents/point, ID B = Rp 6/point, both stored as micros-per-point.
INSERT INTO platform.ledger_fake_backing_rate (region, currency, backing_rate_micros_per_pt)
VALUES ('AU', 'AUD', 3000000), ('ID', 'IDR', 6000000);

CREATE TABLE platform.ledger_fake_quote (
  id                     text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  region                 text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency               text        NOT NULL,
  settlement_minor       bigint      NOT NULL CHECK (settlement_minor >= 0),
  price_points           bigint      NOT NULL CHECK (price_points >= 0),
  backing_rate_id        text        NOT NULL REFERENCES platform.ledger_fake_backing_rate (id),
  demand_multiplier_bps  integer     NOT NULL,
  expires_at             timestamptz NOT NULL,
  locked                 boolean     NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.ledger_fake_rate_proposal (
  id                         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  region                     text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency                   text        NOT NULL,
  backing_rate_micros_per_pt bigint      NOT NULL CHECK (backing_rate_micros_per_pt > 0),
  proposed_by                text        NOT NULL,
  approved_by                text        CHECK (approved_by IS NULL OR approved_by <> proposed_by),
  state                      text        NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved')),
  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.ledger_fake_marketing_fund (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  region      text        NOT NULL CHECK (region IN ('AU', 'ID')),
  amount_minor bigint     NOT NULL CHECK (amount_minor > 0),
  proposed_by text        NOT NULL,
  approved_by text        NOT NULL CHECK (approved_by <> proposed_by),
  funded_at   timestamptz NOT NULL DEFAULT now()
);

-- Purchased-points funding, tracked separately from allocations so
-- `purchasePoints`'s own idempotency key can be checked without scanning
-- every allocation. Reserve cash (K6) is derived as the sum of paid_minor
-- here plus marketing funding, minus nothing this fake models in double-entry
-- -- a simplification the real ledger (Phase 4) does not get to make.
CREATE TABLE platform.ledger_fake_point_purchase (
  id                 text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id        uuid        NOT NULL,
  region             text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency           text        NOT NULL,
  points             bigint      NOT NULL CHECK (points > 0),
  paid_minor         bigint      NOT NULL CHECK (paid_minor > 0),
  allocation_id      text        NOT NULL REFERENCES platform.ledger_fake_allocation (id),
  idempotency_key    text        NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  platform.ledger_fake_allocation,
  platform.ledger_fake_hold,
  platform.ledger_fake_grant,
  platform.ledger_fake_burn,
  platform.ledger_fake_escrow,
  platform.ledger_fake_backing_rate,
  platform.ledger_fake_quote,
  platform.ledger_fake_rate_proposal,
  platform.ledger_fake_marketing_fund,
  platform.ledger_fake_point_purchase
TO yourtal_app;

-- ---------------------------------------------------------------------------
-- voucher-internal fake state
-- ---------------------------------------------------------------------------

CREATE TABLE platform.voucher_fake_batch (
  id                text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  listing_id        uuid        NOT NULL,
  merchant_id       uuid        NOT NULL,
  currency          text        NOT NULL,
  face_value_minor  bigint      NOT NULL CHECK (face_value_minor >= 0),
  quantity          integer     NOT NULL CHECK (quantity > 0),
  requested_by      text        NOT NULL,
  approved_by       text        CHECK (approved_by IS NULL OR approved_by <> requested_by),
  state             text        NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Unlike the real `voucher.code_custody` (docs/15 rule 7: never plaintext),
-- this fake keeps the code in the clear -- it is a development loop over
-- simulated money, never a real bearer instrument, and `reveal` (owner-only)
-- has to be able to hand it back. `code_hash` still exists so lookup-by-code
-- does not need to scan every row, mirroring the real table's shape.
CREATE TABLE platform.voucher_fake_voucher (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid        NOT NULL,
  saga_id    text        NOT NULL UNIQUE,
  owner_id   uuid,
  code       text        NOT NULL,
  code_hash  text        NOT NULL UNIQUE,
  state      text        NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'activated', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT voucher_fake_activated_has_owner CHECK (state <> 'activated' OR owner_id IS NOT NULL)
);

CREATE INDEX voucher_fake_voucher_owner_idx ON platform.voucher_fake_voucher (owner_id);

CREATE TABLE platform.voucher_fake_authorization (
  id              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  voucher_id      uuid        NOT NULL REFERENCES platform.voucher_fake_voucher (id),
  merchant_id     uuid        NOT NULL,
  device_id       text        NOT NULL,
  amount_minor    bigint      NOT NULL CHECK (amount_minor >= 0),
  currency        text        NOT NULL,
  expires_at      timestamptz NOT NULL,
  captured        boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.voucher_fake_capture (
  id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  voucher_id   uuid        NOT NULL REFERENCES platform.voucher_fake_voucher (id),
  merchant_id  uuid        NOT NULL,
  amount_minor bigint      NOT NULL CHECK (amount_minor >= 0),
  currency     text        NOT NULL,
  captured_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX voucher_fake_capture_merchant_idx ON platform.voucher_fake_capture (merchant_id, captured_at);

CREATE TABLE platform.voucher_fake_kill_switch (
  id        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  scope     text        NOT NULL CHECK (scope IN ('merchant', 'listing', 'batch', 'global')),
  target_id text,
  reason    text        NOT NULL,
  set_by    text        NOT NULL,
  active    boolean     NOT NULL DEFAULT true,
  set_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT voucher_fake_kill_switch_target_iff_scoped CHECK (
    (scope = 'global') = (target_id IS NULL)
  )
);

CREATE TABLE platform.voucher_fake_credential (
  id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  merchant_id  uuid        NOT NULL,
  device_id    text        NOT NULL,
  -- SHA-256 hex of the secret. The plaintext is handed back once, at
  -- issuance/rotation, and never stored -- see MerchantCredential's own note.
  secret_hash  text        NOT NULL,
  state        text        NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  issued_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX voucher_fake_credential_merchant_idx ON platform.voucher_fake_credential (merchant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  platform.voucher_fake_batch,
  platform.voucher_fake_voucher,
  platform.voucher_fake_authorization,
  platform.voucher_fake_capture,
  platform.voucher_fake_kill_switch,
  platform.voucher_fake_credential
TO yourtal_app;
