-- The voucher service's schema, as sqlc reads it to type the generated code.
--
-- A COPY of what packages/db/migrations applies, not a second source of
-- truth: Atlas owns the real schema, and `internal/store/schema_test.go`
-- asserts this file still matches the live database — so a drift here fails
-- loudly rather than producing confidently wrong Go types that surface weeks
-- later as a scan error.
CREATE SCHEMA IF NOT EXISTS voucher;
CREATE SCHEMA IF NOT EXISTS store;
CREATE SCHEMA IF NOT EXISTS platform;

-- platform.idempotency (packages/db/migrations/20260919000001) is shared by
-- every service, not owned by voucher — copied here for the same reason as
-- everything else in this file: sqlc needs a schema to type against, and
-- `schema_test.go` is what keeps the copy honest.
CREATE TABLE platform.idempotency (
  scope        text        NOT NULL,
  key          text        NOT NULL,
  fingerprint  char(64)    NOT NULL,
  state        text        NOT NULL,
  status       smallint,
  body         text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE TABLE voucher.batch (
  id                        uuid        PRIMARY KEY,
  listing_id                uuid        NOT NULL,
  supplier_business_id      uuid        NOT NULL,
  -- text, not uuid: packages/db/migrations/20260925210000_voucher_internal_api.sql
  -- brings this in line with ledger.backing_rate_approval.approved_by, since
  -- the voucher-internal contract's requestedBy/approvedBy are free-text
  -- staff identifiers ("staff-1"), not user ids.
  requested_by              text        NOT NULL,
  approved_by               text,
  quantity                  integer     NOT NULL,
  face_value_minor          bigint      NOT NULL,
  settlement_value_minor    bigint      NOT NULL,
  currency                  char(3)     NOT NULL,
  transferable              boolean     NOT NULL,
  partial_redemption_policy text        NOT NULL,
  minimum_spend_minor       bigint,
  expires_at                timestamptz NOT NULL,
  funding_reference         text        NOT NULL,
  manifest_sha256           char(64),
  state                     text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  approved_at               timestamptz
);

CREATE TABLE voucher.vouchers (
  id                        uuid        PRIMARY KEY,
  listing_id                uuid        NOT NULL,
  owner_id                  uuid,
  merchant_id               uuid        NOT NULL,
  merchant_name             text        NOT NULL,
  title                     text        NOT NULL,
  face_value_minor          bigint      NOT NULL,
  remaining_value_minor     bigint      NOT NULL,
  partial_redemption_policy text        NOT NULL,
  minimum_spend_minor       bigint,
  transferable              boolean     NOT NULL,
  issued_at                 timestamptz NOT NULL,
  expires_at                timestamptz NOT NULL,
  location_id               uuid        NOT NULL,
  state                     text        NOT NULL,
  void_reason               text,
  batch_id                  uuid,
  version                   integer     NOT NULL DEFAULT 1,
  currency                  text        NOT NULL,
  -- Added by packages/db/migrations/20260925210000_voucher_internal_api.sql.
  region                    text        NOT NULL,
  saga_id                   text,
  reserved_until            timestamptz
);

CREATE TABLE voucher.code_custody (
  voucher_id       uuid        PRIMARY KEY,
  code_hash        char(64)    NOT NULL UNIQUE,
  wrapped_data_key bytea       NOT NULL,
  nonce            bytea       NOT NULL,
  ciphertext       bytea       NOT NULL,
  key_purpose      text        NOT NULL,
  key_version      integer     NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE voucher.event (
  voucher_id  uuid        NOT NULL,
  seq         integer     NOT NULL,
  event_type  text        NOT NULL,
  detail      jsonb       NOT NULL,
  prev_hash   char(64)    NOT NULL,
  hash        char(64)    NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (voucher_id, seq)
);

CREATE TABLE voucher.authorization (
  id                 uuid        PRIMARY KEY,
  voucher_id         uuid        NOT NULL,
  merchant_id        uuid        NOT NULL,
  amount_minor       bigint      NOT NULL,
  currency           char(3)     NOT NULL,
  merchant_order_ref text        NOT NULL,
  state              text        NOT NULL,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  order_total_minor  bigint,
  -- Added by packages/db/migrations/20260925210000_voucher_internal_api.sql.
  device_id          text
);

CREATE TABLE voucher.capture (
  id                      uuid        PRIMARY KEY,
  authorization_id        uuid        NOT NULL UNIQUE,
  authorized_amount_minor bigint      NOT NULL,
  amount_minor            bigint      NOT NULL,
  receipt_id              text        NOT NULL UNIQUE,
  settled_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE voucher.refund (
  id           uuid        PRIMARY KEY,
  capture_id   uuid        NOT NULL,
  amount_minor bigint      NOT NULL,
  reason       text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  refund_ref   text
);

CREATE TABLE voucher.merchant_signature_seen (
  key_id  text        NOT NULL,
  mac     bytea       NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, mac)
);

CREATE TABLE voucher.merchant_credential (
  key_id           text        PRIMARY KEY,
  merchant_id      uuid        NOT NULL,
  wrapped_data_key bytea       NOT NULL,
  nonce            bytea       NOT NULL,
  ciphertext       bytea       NOT NULL,
  key_purpose      text        NOT NULL,
  key_version      integer     NOT NULL,
  state            text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  not_after        timestamptz,
  revoked_at       timestamptz,
  -- Added by packages/db/migrations/20260925210000_voucher_internal_api.sql.
  device_id        text
);

CREATE TABLE voucher.kill_switch (
  id         uuid        PRIMARY KEY,
  scope      text        NOT NULL,
  scope_id   uuid,
  reason     text        NOT NULL,
  enabled_by text        NOT NULL,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  lifted_by  text,
  lifted_at  timestamptz
);

CREATE TABLE voucher.redemption_attempt (
  id           bigserial   PRIMARY KEY,
  merchant_id  uuid        NOT NULL,
  outcome      text        NOT NULL,
  amount_minor bigint,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE store.listings (
  id                        uuid        PRIMARY KEY,
  merchant_id               uuid        NOT NULL,
  merchant_name             text        NOT NULL,
  title                     text        NOT NULL,
  description               text        NOT NULL,
  category                  text        NOT NULL,
  face_value_minor          bigint      NOT NULL,
  settlement_value_minor    bigint      NOT NULL,
  price_in_points           bigint      NOT NULL,
  stock_remaining           integer     NOT NULL,
  stock_total               integer     NOT NULL,
  transferable              boolean     NOT NULL,
  partial_redemption_policy text        NOT NULL,
  minimum_spend_minor       bigint,
  expires_at                timestamptz NOT NULL,
  status                    text        NOT NULL,
  -- Added by packages/db/migrations/20260920040000_store_listing_management.sql.
  -- This service does not read either column; they are mirrored because the
  -- drift guard compares this whole table against the live database, and a
  -- mirror that omits a column cannot tell "not needed here" apart from
  -- "nobody noticed it was added".
  lifecycle_state           text        NOT NULL DEFAULT 'active',
  per_user_limit            integer,
  -- Added by packages/db/migrations/20260922030000_currency_tagged_money.sql.
  -- 20260925063126 adds UNIQUE (id, currency) on top, not mirrored here: the
  -- drift guard above only compares column names, not constraints.
  currency                  text        NOT NULL,
  -- Added by 20260925190000 (1.1.b), mirrored for the drift guard only.
  region                    text        NOT NULL,
  audience                  text        NOT NULL,
  content_category          text        NOT NULL,
  image_url                 text        NOT NULL,
  channel                   text        NOT NULL,
  partial_redemption        text        NOT NULL
);

CREATE TABLE store.listing_location (
  listing_id  uuid NOT NULL,
  location_id uuid NOT NULL,
  PRIMARY KEY (listing_id, location_id)
);
