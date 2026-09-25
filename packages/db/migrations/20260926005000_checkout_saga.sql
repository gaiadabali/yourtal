-- 4.7: the burn saga. A checkout is one row: quoted (the ledger holds its
-- price for 15 minutes), then reserved, burned and done, or released or
-- voided. Its id is the saga id every service keys its step on.
CREATE SCHEMA IF NOT EXISTS checkout;
GRANT USAGE ON SCHEMA checkout TO yourtal_app;

CREATE TABLE checkout.saga (
  id               uuid        PRIMARY KEY,
  user_id          uuid        NOT NULL,
  listing_id       uuid        NOT NULL,
  region           text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency         char(3)     NOT NULL,
  quote_id         uuid        NOT NULL UNIQUE,
  price_points     bigint      NOT NULL CHECK (price_points > 0),
  settlement_minor bigint      NOT NULL CHECK (settlement_minor > 0),
  state            text        NOT NULL DEFAULT 'quoted'
    CHECK (state IN ('quoted', 'reserved', 'burned', 'done', 'released', 'voided')),
  voucher_id       uuid,
  quote_expires_at timestamptz NOT NULL,
  reserved_until   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saga_cash_in_its_region CHECK ((currency = 'AUD' AND region = 'AU') OR (currency = 'IDR' AND region = 'ID')),
  CONSTRAINT saga_voucher_once_reserved CHECK (state IN ('quoted', 'released') OR voucher_id IS NOT NULL)
);

-- The recovery job's work list: sagas a crash left between steps.
CREATE INDEX saga_unfinished ON checkout.saga (reserved_until) WHERE state IN ('reserved', 'burned');
CREATE INDEX saga_by_user ON checkout.saga (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON checkout.saga TO yourtal_app;
REVOKE DELETE ON checkout.saga FROM yourtal_app;
