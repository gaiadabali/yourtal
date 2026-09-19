-- The ledger schema, as sqlc reads it to type the generated code.
--
-- A COPY of what packages/db/migrations applies, not a second source of
-- truth: Atlas owns the real schema, and `internal/store/schema_test.go`
-- asserts this file still matches the live database so a drift here fails
-- loudly rather than producing confidently wrong Go types.
CREATE SCHEMA IF NOT EXISTS ledger;

CREATE TABLE ledger.account (
  id          text        PRIMARY KEY,
  owner_type  text        NOT NULL,
  owner_id    text        NOT NULL,
  currency    char(3)     NOT NULL,
  kind        text        NOT NULL,
  country     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.transfer (
  id               text        PRIMARY KEY,
  idempotency_key  text        NOT NULL UNIQUE,
  reason_code      text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.entry (
  id            bigserial   PRIMARY KEY,
  transfer_id   text        NOT NULL REFERENCES ledger.transfer (id),
  account_id    text        NOT NULL REFERENCES ledger.account (id),
  amount_minor  bigint      NOT NULL,
  currency      char(3)     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.allocation (
  id               text        PRIMARY KEY,
  funder_type      text        NOT NULL,
  funder_id        text        NOT NULL,
  currency         char(3)     NOT NULL,
  total_points     bigint      NOT NULL,
  remaining_points bigint      NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.grant (
  id            text        PRIMARY KEY,
  user_id       text        NOT NULL,
  action_type   text        NOT NULL,
  taxonomy_ver  integer     NOT NULL,
  points        bigint      NOT NULL,
  allocation_id text        NOT NULL REFERENCES ledger.allocation (id),
  transfer_id   text        NOT NULL REFERENCES ledger.transfer (id),
  device_id     text,
  ip_address    text,
  external_ref  text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.point_purchase (
  id               text        PRIMARY KEY,
  partner_id       text        NOT NULL,
  points           bigint      NOT NULL,
  amount_minor     bigint      NOT NULL,
  currency         char(3)     NOT NULL,
  allocation_id    text        NOT NULL REFERENCES ledger.allocation (id),
  cash_transfer_id text        NOT NULL REFERENCES ledger.transfer (id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.daily_proof (
  proof_date     date        PRIMARY KEY,
  merkle_root    char(64)    NOT NULL,
  entry_count    bigint      NOT NULL,
  first_entry_id bigint,
  last_entry_id  bigint,
  computed_at    timestamptz NOT NULL DEFAULT now()
);
