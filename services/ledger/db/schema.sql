-- The ledger schema, as sqlc reads it to type the generated code.
--
-- A COPY of what packages/db/migrations applies, not a second source of
-- truth: Atlas owns the real schema, and `internal/store/schema_test.go`
-- asserts this file still matches the live database so a drift here fails
-- loudly rather than producing confidently wrong Go types.
CREATE SCHEMA IF NOT EXISTS ledger;

CREATE TABLE ledger.account (
  id               text        PRIMARY KEY,
  owner_type       text        NOT NULL,
  owner_id         text        NOT NULL,
  currency         char(3)     NOT NULL,
  kind             text        NOT NULL,
  country          text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  purpose          text        NOT NULL DEFAULT 'main',
  last_activity_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.transfer (
  id               text        PRIMARY KEY,
  idempotency_key  text        NOT NULL UNIQUE,
  reason_code      text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  reverses         text        UNIQUE REFERENCES ledger.transfer (id),
  request_hash     bytea
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
  created_at       timestamptz NOT NULL DEFAULT now(),
  region           text
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
  created_at    timestamptz NOT NULL DEFAULT now(),
  campaign_id   uuid,
  region        text,
  unlock_at     timestamptz,
  idempotency_key text,
  session_id    text,
  terms_version integer,
  asked         integer,
  correct       integer
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
  computed_at    timestamptz NOT NULL DEFAULT now(),
  -- Added by packages/db/migrations/20260926121000_voucher_head_anchor.sql.
  ledger_root        text,
  voucher_heads_root text,
  voucher_head_count bigint NOT NULL DEFAULT 0
);

-- Added by packages/db/migrations/20260926121000_voucher_head_anchor.sql.
CREATE TABLE ledger.voucher_head_anchor (
  id         bigserial   PRIMARY KEY,
  voucher_id uuid        NOT NULL,
  seq        bigint      NOT NULL,
  head_hash  char(64)    NOT NULL,
  region     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (voucher_id, seq)
);

-- Added by packages/db/migrations/20260926120000_ledger_captures.sql.
CREATE TABLE ledger.capture (
  capture_id   text        PRIMARY KEY,
  region       text        NOT NULL,
  merchant_id  text        NOT NULL,
  amount_minor bigint      NOT NULL,
  currency     char(3)     NOT NULL,
  transfer_id  text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.backing_rate (
  id                           text        PRIMARY KEY,
  currency                     char(3)     NOT NULL,
  micros_per_point             bigint      NOT NULL,
  issue_price_micros_per_point bigint      NOT NULL,
  effective_from               timestamptz NOT NULL,
  reason                       text        NOT NULL,
  set_by                       text        NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.backing_rate_approval (
  rate_id     text        PRIMARY KEY REFERENCES ledger.backing_rate (id),
  approved_by    text        NOT NULL,
  approved_at    timestamptz NOT NULL DEFAULT now(),
  effective_from timestamptz NOT NULL
);

CREATE TABLE ledger.marketing_funding (
  id           text        PRIMARY KEY,
  region       text        NOT NULL,
  amount_minor bigint      NOT NULL,
  proposed_by  text        NOT NULL,
  approved_by  text        NOT NULL,
  transfer_id  text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.allocation_hold (
  id              text        PRIMARY KEY,
  allocation_id   text        NOT NULL REFERENCES ledger.allocation (id),
  points          bigint      NOT NULL,
  state           text        NOT NULL,
  consumed_points bigint,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE TABLE ledger.allocation_return (
  grant_id    text        PRIMARY KEY REFERENCES ledger.grant (id),
  points      bigint      NOT NULL,
  returned_at timestamptz NOT NULL DEFAULT now()
);

-- Signatures only, so sqlc can type the calls. The bodies are in
-- packages/db/migrations/20260925195500_allocation_holds.sql.
CREATE FUNCTION ledger.allocation_hold(p_hold_id text, p_allocation_id text, p_points bigint, p_ttl_seconds bigint)
  RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION ledger.allocation_consume(p_hold_id text, p_points bigint)
  RETURNS text LANGUAGE sql AS $$ SELECT '' $$;
CREATE FUNCTION ledger.allocation_release(p_hold_id text)
  RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION ledger.allocation_release_expired()
  RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION ledger.allocation_return(p_grant_id text)
  RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;

CREATE TABLE ledger.burn (
  saga_id               text        PRIMARY KEY,
  user_id               text        NOT NULL,
  region                text        NOT NULL,
  points                bigint      NOT NULL,
  settlement_minor      bigint      NOT NULL,
  points_transfer_id    text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  liability_transfer_id text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  listing_id            uuid
);

CREATE TABLE ledger.burn_reinstatement (
  saga_id               text        PRIMARY KEY REFERENCES ledger.burn (saga_id),
  points_transfer_id    text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  liability_transfer_id text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  reason                text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.grant_release (
  grant_id    text        PRIMARY KEY REFERENCES ledger.grant (id),
  transfer_id text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.release_notice (
  grant_id   text        PRIMARY KEY REFERENCES ledger.grant_release (grant_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.escrow (
  id               text        PRIMARY KEY,
  idempotency_key  text        NOT NULL UNIQUE,
  user_id          text        NOT NULL,
  region           text        NOT NULL,
  points           bigint      NOT NULL,
  available_points bigint      NOT NULL,
  pending_points   bigint      NOT NULL,
  reason           text        NOT NULL,
  transfer_id      text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.escrow_release (
  escrow_id   text        PRIMARY KEY REFERENCES ledger.escrow (id),
  transfer_id text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.risk_flag (
  id              text        PRIMARY KEY,
  user_id         text        NOT NULL,
  region          text        NOT NULL,
  severity        text        NOT NULL,
  reason          text        NOT NULL,
  signals         jsonb       NOT NULL,
  escrow_id       text        REFERENCES ledger.escrow (id),
  status          text        NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text
);

CREATE TABLE ledger.points_expiry_notice (
  account_id     text        NOT NULL REFERENCES ledger.account (id),
  milestone_days integer     NOT NULL,
  expiring_at    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  notified_at    timestamptz
);

CREATE TABLE ledger.quote (
  id               uuid        PRIMARY KEY,
  region           text        NOT NULL,
  currency         char(3)     NOT NULL,
  settlement_minor bigint      NOT NULL,
  price_points     bigint      NOT NULL,
  backing_rate_id  text        NOT NULL REFERENCES ledger.backing_rate (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL
);

CREATE TABLE ledger.quote_lock (
  quote_id  uuid        PRIMARY KEY REFERENCES ledger.quote (id),
  locked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.listing_price (
  listing_id       uuid        PRIMARY KEY,
  region           text        NOT NULL,
  currency         char(3)     NOT NULL,
  settlement_minor bigint      NOT NULL,
  price_points     bigint      NOT NULL,
  backing_rate_id  text        NOT NULL REFERENCES ledger.backing_rate (id),
  computed_at      timestamptz NOT NULL DEFAULT now()
);

-- Read-only to the ledger (20260922020000): which allocation pays a
-- campaign, and the most one completion may earn.
CREATE SCHEMA IF NOT EXISTS campaign;
CREATE TABLE campaign.reward_config (
  campaign_id                  uuid   PRIMARY KEY,
  allocation_id                text   NOT NULL,
  funder_type                  text   NOT NULL,
  max_points_for_campaign      bigint NOT NULL,
  reward_points_per_completion bigint NOT NULL,
  accuracy_bonus_points        bigint NOT NULL
);

-- Views over the campaign tables (20260925210000), read-only to the ledger.
-- Declared as tables so sqlc can type them.
CREATE TABLE campaign.campaign_owner (
  id          uuid NOT NULL,
  business_id uuid NOT NULL,
  region      text NOT NULL,
  state       text NOT NULL
);

CREATE TABLE campaign.campaign_terms (
  campaign_id           uuid    NOT NULL,
  version               integer NOT NULL,
  reward_points         bigint  NOT NULL,
  question_count        integer NOT NULL,
  scoring_rule          text    NOT NULL,
  accuracy_bonus_points bigint  NOT NULL
);

-- Added by packages/db/migrations/20260929070900_ledger_incident_and_heartbeat.sql (10.3.c).
CREATE TABLE ledger.incident (
  id        bigserial   PRIMARY KEY,
  summary   text        NOT NULL,
  detail    text        NOT NULL,
  raised_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger.job_heartbeat (
  job_name         text        PRIMARY KEY,
  last_run_at      timestamptz NOT NULL DEFAULT now(),
  interval_seconds bigint      NOT NULL
);

-- Added by packages/db/migrations/20260929070000_ledger_settlement.sql (10.1).
CREATE TABLE ledger.statement (
  id                     text        PRIMARY KEY,
  business_id            text        NOT NULL,
  region                 text        NOT NULL,
  currency               char(3)     NOT NULL,
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
  payout_transfer_id     text REFERENCES ledger.transfer (id)
);

CREATE TABLE ledger.capture_recovery (
  id           text        PRIMARY KEY,
  capture_id   text        NOT NULL UNIQUE REFERENCES ledger.capture (capture_id),
  region       text        NOT NULL,
  merchant_id  text        NOT NULL,
  amount_minor bigint      NOT NULL,
  currency     char(3)     NOT NULL,
  reason       text        NOT NULL,
  transfer_id  text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
