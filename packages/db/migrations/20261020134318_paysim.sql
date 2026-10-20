-- 5.1.e / 14.7.a (F106): the payment simulation's own storage. It speaks
-- Stripe's API so the real Stripe driver can run on staging against it.
-- Production never writes these tables: the API refuses to boot with the
-- simulation enabled on APP_ENV=production. No region wall: these are test
-- objects with no region, and nothing real is ever stored here (no card
-- number, only brand, last4 and expiry).
CREATE SCHEMA IF NOT EXISTS paysim;

-- Every Stripe object (and every event) as jsonb, by id. `internal` holds what
-- the API never returns (balances, test-card scenario, link targets). `due_at`
-- is when the sweep should look at the row next.
CREATE TABLE paysim.object (
  id         text        PRIMARY KEY,
  type       text        NOT NULL,
  account    text,
  data       jsonb       NOT NULL,
  internal   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  due_at     timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX object_type_idx ON paysim.object (type);
CREATE INDEX object_due_idx ON paysim.object (due_at) WHERE due_at IS NOT NULL;

-- Idempotency-Key records, per Stripe-Account scope. Honoured for 24 hours.
CREATE TABLE paysim.idempotency (
  scope        text        NOT NULL,
  key          text        NOT NULL,
  request_hash text        NOT NULL,
  status       integer     NOT NULL,
  body         text        NOT NULL,
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (scope, key)
);

-- One webhook delivery per event, retried on Stripe's schedule.
CREATE TABLE paysim.delivery (
  id               text        PRIMARY KEY,
  event_id         text        NOT NULL REFERENCES paysim.object (id),
  attempts         integer     NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL,
  status           text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  last_status_code integer,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_due_idx ON paysim.delivery (next_attempt_at) WHERE status = 'pending';

GRANT USAGE ON SCHEMA paysim TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON paysim.object, paysim.idempotency, paysim.delivery TO yourtal_app;
