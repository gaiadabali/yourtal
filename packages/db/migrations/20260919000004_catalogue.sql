-- YT-0519: campaign, store and voucher tables, so the stack can hold the
-- data Phase U has so far only had as fixtures.
--
-- Shapes follow packages/contracts exactly — these are the same schemas the
-- OpenAPI document and the Go types are generated from, so a column that
-- disagrees with a Zod field is a bug in one of the two.
--
-- MONEY: bigint minor units, as in the ledger migration. Whether an IDR
-- minor unit is a Rupiah or a sen is STILL YT-0506 and still open; these
-- columns are correct under either answer, and the seed writes whatever the
-- contracts currently mean. That question has to be settled once, in
-- money.ts, not re-litigated per table.

CREATE TABLE campaign.campaigns (
  id                 uuid        PRIMARY KEY,
  kind               text        NOT NULL CHECK (kind IN ('long_form','quick')),
  title              text        NOT NULL,
  merchant_id        uuid        NOT NULL,
  merchant_name      text        NOT NULL,
  synopsis           text        NOT NULL,
  duration_seconds   integer     NOT NULL CHECK (duration_seconds > 0),
  estimated_data_mb  numeric     NOT NULL CHECK (estimated_data_mb > 0),
  reward_points      bigint      NOT NULL CHECK (reward_points >= 0),
  question_count     integer     NOT NULL CHECK (question_count >= 0),
  scoring_rule       text        NOT NULL CHECK (scoring_rule IN ('base_only','base_plus_accuracy_bonus')),
  status             text        NOT NULL CHECK (status IN ('active','paused','ended')),
  published_at       timestamptz NOT NULL,

  -- Both of campaignSchema's refinements, which JSON Schema could not carry
  -- into the OpenAPI document (see packages/contracts/openapi/README.md) but
  -- Postgres can. This is the "re-implement and test the rule" half of that
  -- note, done where it cannot be bypassed.
  CONSTRAINT campaigns_quick_is_short CHECK (kind <> 'quick' OR duration_seconds <= 60),
  CONSTRAINT campaigns_bonus_needs_questions CHECK (
    scoring_rule <> 'base_plus_accuracy_bonus' OR question_count > 0
  )
);

CREATE INDEX campaigns_status_idx ON campaign.campaigns (status);

CREATE TABLE store.listings (
  id                        uuid        PRIMARY KEY,
  merchant_id               uuid        NOT NULL,
  merchant_name             text        NOT NULL,
  title                     text        NOT NULL,
  description               text        NOT NULL,
  category                  text        NOT NULL,
  district                  text        NOT NULL,
  face_value_idr            bigint      NOT NULL CHECK (face_value_idr >= 0),
  settlement_value_idr      bigint      NOT NULL CHECK (settlement_value_idr >= 0),
  price_in_points           bigint      NOT NULL CHECK (price_in_points >= 0),
  stock_remaining           integer     NOT NULL CHECK (stock_remaining >= 0),
  stock_total               integer     NOT NULL CHECK (stock_total > 0),
  transferable              boolean     NOT NULL,
  partial_redemption_policy text        NOT NULL CHECK (
    partial_redemption_policy IN ('balance_carrying','single_use_forfeit','minimum_spend')),
  minimum_spend_idr         bigint,
  expires_at                timestamptz NOT NULL,
  status                    text        NOT NULL CHECK (
    status IN ('available','sold_out','expiring_soon','new')),

  -- listingSchema's four refinements. The settlement one is an ECONOMIC
  -- invariant, not a formatting rule: settlement above face value means the
  -- platform pays out more than the voucher was ever worth, on every
  -- redemption, silently.
  CONSTRAINT listings_stock_within_total CHECK (stock_remaining <= stock_total),
  CONSTRAINT listings_settlement_within_face CHECK (settlement_value_idr <= face_value_idr),
  CONSTRAINT listings_sold_out_has_no_stock CHECK (status <> 'sold_out' OR stock_remaining = 0),
  CONSTRAINT listings_minimum_spend_iff_policy CHECK (
    (partial_redemption_policy = 'minimum_spend') = (minimum_spend_idr IS NOT NULL)
  )
);

CREATE INDEX listings_merchant_idx ON store.listings (merchant_id);
CREATE INDEX listings_status_idx   ON store.listings (status);

CREATE TABLE voucher.vouchers (
  id                        uuid        PRIMARY KEY,
  listing_id                uuid        NOT NULL REFERENCES store.listings (id),
  owner_id                  uuid        NOT NULL,
  code                      text        NOT NULL UNIQUE,
  -- The identity a redemption is authorized against. Comparing merchant_name
  -- instead is how two outlets sharing a name redeem each other's vouchers.
  merchant_id               uuid        NOT NULL,
  merchant_name             text        NOT NULL,
  title                     text        NOT NULL,
  face_value_idr            bigint      NOT NULL CHECK (face_value_idr >= 0),
  remaining_value_idr       bigint      NOT NULL CHECK (remaining_value_idr >= 0),
  partial_redemption_policy text        NOT NULL CHECK (
    partial_redemption_policy IN ('balance_carrying','single_use_forfeit','minimum_spend')),
  minimum_spend_idr         bigint,
  transferable              boolean     NOT NULL,
  status                    text        NOT NULL CHECK (
    status IN ('active','redeemed','expired','transferred')),
  issued_at                 timestamptz NOT NULL,
  expires_at                timestamptz NOT NULL,

  CONSTRAINT vouchers_remaining_within_face CHECK (remaining_value_idr <= face_value_idr),
  CONSTRAINT vouchers_expires_after_issue CHECK (expires_at > issued_at),
  CONSTRAINT vouchers_minimum_spend_iff_policy CHECK (
    (partial_redemption_policy = 'minimum_spend') = (minimum_spend_idr IS NOT NULL)
  )
);

CREATE INDEX vouchers_owner_idx    ON voucher.vouchers (owner_id);
CREATE INDEX vouchers_merchant_idx ON voucher.vouchers (merchant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign.campaigns TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON store.listings     TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON voucher.vouchers   TO yourtal_app;
