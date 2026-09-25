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
  created_at  timestamptz NOT NULL DEFAULT now(),
  purpose     text        NOT NULL DEFAULT 'main'
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
  computed_at    timestamptz NOT NULL DEFAULT now()
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
