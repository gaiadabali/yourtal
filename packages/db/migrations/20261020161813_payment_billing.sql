-- 5.1.a / 14.7.b (F106, F107, F118): the app side of Stripe payments. Points
-- are bought through a hosted checkout and granted only when a verified
-- webhook says the money arrived; boosts charge a card saved beforehand.
-- Amounts are integer minor units with their currency, and AU prices are
-- ex-GST: GST is recorded beside the subtotal, never folded into it.
CREATE SCHEMA IF NOT EXISTS payment;
GRANT USAGE ON SCHEMA payment TO yourtal_app;

-- One provider customer per owner (a business now, a bidder with auctions).
CREATE TABLE payment.customer (
  owner_kind   text        NOT NULL CHECK (owner_kind IN ('business', 'user')),
  owner_id     uuid        NOT NULL,
  region       text        NOT NULL CHECK (region IN ('AU', 'ID')),
  provider     text        NOT NULL CHECK (provider IN ('stripe', 'simulated')),
  customer_ref text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_kind, owner_id, provider)
);

-- Only brand, last4 and expiry: no card number ever reaches this database.
CREATE TABLE payment.saved_card (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind         text        NOT NULL CHECK (owner_kind IN ('business', 'user')),
  owner_id           uuid        NOT NULL,
  region             text        NOT NULL CHECK (region IN ('AU', 'ID')),
  provider           text        NOT NULL CHECK (provider IN ('stripe', 'simulated')),
  customer_ref       text        NOT NULL,
  payment_method_ref text        NOT NULL,
  brand              text        NOT NULL,
  last4              text        NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  exp_month          integer     NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year           integer     NOT NULL CHECK (exp_year BETWEEN 2000 AND 2100),
  created_at         timestamptz NOT NULL DEFAULT now(),
  replaced_at        timestamptz
);
-- One live card per owner and provider; a replaced card stays for the record.
CREATE UNIQUE INDEX saved_card_one_live_idx
  ON payment.saved_card (owner_kind, owner_id, provider) WHERE replaced_at IS NULL;

CREATE TABLE payment.card_setup (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind   text        NOT NULL CHECK (owner_kind IN ('business', 'user')),
  owner_id     uuid        NOT NULL,
  region       text        NOT NULL CHECK (region IN ('AU', 'ID')),
  provider     text        NOT NULL CHECK (provider IN ('stripe', 'simulated')),
  checkout_ref text        UNIQUE,
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'saved', 'expired')),
  return_path  text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX card_setup_owner_idx ON payment.card_setup (owner_kind, owner_id, created_at DESC);

-- A business buying points by card. `needs_review` is money received that the
-- ledger would not turn into points (the rate rose while the page was open, or
-- the amount paid did not match): staff settle it, nothing is dropped.
CREATE TABLE payment.card_purchase (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid        NOT NULL,
  region              text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency            text        NOT NULL CHECK (currency IN ('AUD', 'IDR')),
  points              bigint      NOT NULL CHECK (points > 0),
  subtotal_minor      bigint      NOT NULL CHECK (subtotal_minor > 0),
  tax_minor           bigint      NOT NULL CHECK (tax_minor >= 0),
  total_minor         bigint      NOT NULL,
  tax_rate_bps        integer     NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  idempotency_key     text        NOT NULL UNIQUE,
  provider            text        NOT NULL CHECK (provider IN ('stripe', 'simulated')),
  checkout_ref        text        UNIQUE,
  checkout_expires_at timestamptz NOT NULL,
  payment_ref         text,
  status              text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'paid', 'expired', 'needs_review')),
  review_reason       text,
  allocation_id       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz,
  CONSTRAINT card_purchase_total CHECK (total_minor = subtotal_minor + tax_minor),
  CONSTRAINT card_purchase_currency_matches_region CHECK ((region = 'AU') = (currency = 'AUD')),
  CONSTRAINT card_purchase_review_has_reason CHECK ((status = 'needs_review') = (review_reason IS NOT NULL)),
  CONSTRAINT card_purchase_paid_has_allocation CHECK (status <> 'paid' OR allocation_id IS NOT NULL)
);
CREATE INDEX card_purchase_business_idx ON payment.card_purchase (business_id, created_at DESC);
CREATE INDEX card_purchase_review_idx ON payment.card_purchase (created_at) WHERE status = 'needs_review';

-- The webhook inbox: an event id is claimed before anything acts on it, and
-- `processed_at` is set only once every handler succeeded.
CREATE TABLE payment.provider_event (
  event_id     text        PRIMARY KEY,
  provider     text        NOT NULL CHECK (provider IN ('stripe', 'simulated')),
  type         text        NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- Boost days below the processor's minimum wait and are charged together.
-- A batch is written before the card is charged, so a crash after the charge
-- retries the same key for the same days instead of charging them again.
CREATE TABLE feed.boost_charge_batch (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_key         text        NOT NULL,
  campaign_id        uuid        NOT NULL REFERENCES feed.boost (campaign_id),
  business_id        uuid        NOT NULL,
  region             text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency           text        NOT NULL CHECK (currency IN ('AUD', 'IDR')),
  first_day          date        NOT NULL,
  last_day           date        NOT NULL,
  subtotal_minor     bigint      NOT NULL CHECK (subtotal_minor > 0),
  tax_minor          bigint      NOT NULL CHECK (tax_minor >= 0),
  total_minor        bigint      NOT NULL,
  tax_rate_bps       integer     NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  -- The card the key was first sent with: a retry must send the same one.
  customer_ref       text        NOT NULL,
  payment_method_ref text        NOT NULL,
  status             text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'charged', 'declined')),
  provider_reference text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  decided_at         timestamptz,
  CONSTRAINT boost_charge_batch_total CHECK (total_minor = subtotal_minor + tax_minor),
  CONSTRAINT boost_charge_batch_days CHECK (last_day >= first_day),
  CONSTRAINT boost_charge_batch_currency_matches_region CHECK ((region = 'AU') = (currency = 'AUD'))
);
-- A declined batch is kept; its days are tried again under the same key.
CREATE UNIQUE INDEX boost_charge_batch_open_key_idx
  ON feed.boost_charge_batch (charge_key) WHERE status <> 'declined';
CREATE INDEX boost_charge_batch_pending_idx ON feed.boost_charge_batch (campaign_id) WHERE status = 'pending';

-- amount_minor stays what was charged for the day (GST included); older rows
-- predate GST and leave the split null.
ALTER TABLE feed.boost_charge
  ADD COLUMN subtotal_minor bigint CHECK (subtotal_minor > 0),
  ADD COLUMN tax_minor bigint CHECK (tax_minor >= 0),
  ADD COLUMN batch_id uuid REFERENCES feed.boost_charge_batch (id);

GRANT SELECT, INSERT, UPDATE ON payment.customer, payment.saved_card, payment.card_setup,
  payment.card_purchase, payment.provider_event, feed.boost_charge_batch TO yourtal_app;

ALTER TABLE payment.customer ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON payment.customer
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE payment.saved_card ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON payment.saved_card
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE payment.card_setup ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON payment.card_setup
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE payment.card_purchase ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON payment.card_purchase
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE feed.boost_charge_batch ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON feed.boost_charge_batch
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

-- F118: GST in basis points, a region setting like every F12 number (editable
-- in the staff console with two-person approval). AU 10%; Indonesia adds none.
INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from) VALUES
  ('AU', 'gst_rate_bps', '{"rateBps": 1000}'::jsonb, 'founder', 'plan-f118', now()),
  ('ID', 'gst_rate_bps', '{"rateBps": 0}'::jsonb, 'founder', 'plan-f118', now());
