-- 4.1.b: what the ledger's live routes need to answer the ledger-internal
-- contract: regions on allocations, holdback on grants, stored quotes, and
-- the listing price the ledger owns (4.9.a).

-- An allocation belongs to one region. NULL only on rows from before this.
ALTER TABLE ledger.allocation ADD COLUMN region text CHECK (region IN ('AU', 'ID'));

-- 4.4.g: a grant waits in pending until unlock_at (F12 holdback by trust
-- tier); the release job moves it to available and records it here, once.
ALTER TABLE ledger.grant
  ADD COLUMN campaign_id     uuid,
  ADD COLUMN region          text CHECK (region IN ('AU', 'ID')),
  ADD COLUMN unlock_at       timestamptz,
  -- The caller's key, so a replay returns the grant and a changed body is
  -- idempotency_conflict (ledger-internal's grantReward/grantAction).
  ADD COLUMN idempotency_key text;
CREATE INDEX grant_unlock_idx ON ledger.grant (unlock_at);

CREATE TABLE ledger.grant_release (
  grant_id    text        PRIMARY KEY REFERENCES ledger.grant (id),
  transfer_id text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  released_at timestamptz NOT NULL DEFAULT now()
);

-- A quote is priced at the database's now() and lives 15 minutes; locking
-- it is its own append-only row (EM-19).
CREATE TABLE ledger.quote (
  id               uuid        PRIMARY KEY,
  region           text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency         char(3)     NOT NULL,
  settlement_minor bigint      NOT NULL CHECK (settlement_minor > 0),
  price_points     bigint      NOT NULL CHECK (price_points > 0),
  backing_rate_id  text        NOT NULL REFERENCES ledger.backing_rate (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  CONSTRAINT quote_cash_in_its_region CHECK ((currency = 'AUD' AND region = 'AU') OR (currency = 'IDR' AND region = 'ID'))
);
CREATE TABLE ledger.quote_lock (
  quote_id  uuid        PRIMARY KEY REFERENCES ledger.quote (id),
  locked_at timestamptz NOT NULL DEFAULT now()
);

-- 4.9.a: the points price of a listing, owned by the ledger. Written when a
-- listing is priced; a burn reads its S and region from here, never from
-- the caller.
CREATE TABLE ledger.listing_price (
  listing_id       uuid        PRIMARY KEY,
  region           text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency         char(3)     NOT NULL,
  settlement_minor bigint      NOT NULL CHECK (settlement_minor > 0),
  price_points     bigint      NOT NULL CHECK (price_points > 0),
  backing_rate_id  text        NOT NULL REFERENCES ledger.backing_rate (id),
  computed_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_price_cash_in_its_region CHECK ((currency = 'AUD' AND region = 'AU') OR (currency = 'IDR' AND region = 'ID'))
);

-- A burn names the listing it bought.
ALTER TABLE ledger.burn ADD COLUMN listing_id uuid;

CREATE TRIGGER grant_release_stamp_now BEFORE INSERT ON ledger.grant_release
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();
CREATE TRIGGER quote_stamp_now BEFORE INSERT ON ledger.quote
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();

GRANT SELECT, INSERT ON ledger.grant_release, ledger.quote, ledger.quote_lock TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.grant_release, ledger.quote, ledger.quote_lock FROM yourtal_ledger;
-- A listing's price changes when its S or the rate changes (upsert).
GRANT SELECT, INSERT, UPDATE ON ledger.listing_price TO yourtal_ledger;
REVOKE DELETE ON ledger.listing_price FROM yourtal_ledger;
REVOKE ALL ON ledger.grant_release, ledger.quote, ledger.quote_lock, ledger.listing_price FROM yourtal_app;
