-- 13.23 (F86): business boost. A live campaign bids cash per 1,000 boosted
-- impressions for the Home feed's reserved slots, second price, paced against
-- a daily budget and billed through the payment driver apart from points.
-- Nothing here touches a reward: boost only decides which card fills a slot.

CREATE TABLE feed.boost (
  campaign_id        uuid        PRIMARY KEY REFERENCES campaign.campaigns (id),
  business_id        uuid        NOT NULL,
  region             text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency           text        NOT NULL CHECK (currency IN ('AUD', 'IDR')),
  daily_budget_minor bigint      NOT NULL CHECK (daily_budget_minor > 0),
  max_bid_cpm_minor  bigint      NOT NULL CHECK (max_bid_cpm_minor > 0),
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL,
  state              text        NOT NULL CHECK (state IN ('active', 'paused')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- AU and ID are separate economies (F2): the currency follows the region.
  CONSTRAINT boost_currency_matches_region CHECK ((region = 'AU') = (currency = 'AUD')),
  CONSTRAINT boost_window CHECK (ends_at > starts_at)
);

-- Spend per campaign per region-local day, in thousandths of a minor unit:
-- one impression at a CPM of N minor units costs N/1000, kept exact. The
-- budget check is a conditional upsert on this row, so concurrent feeds
-- cannot overspend.
CREATE TABLE feed.boost_spend_day (
  campaign_id  uuid    NOT NULL REFERENCES feed.boost (campaign_id),
  day          date    NOT NULL,
  impressions  integer NOT NULL CHECK (impressions >= 0),
  spent_milli  bigint  NOT NULL CHECK (spent_milli >= 0),
  PRIMARY KEY (campaign_id, day)
);

-- One row per slot won: the clearing price (second bid + 1, or the reserve).
CREATE TABLE feed.boost_impression (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid        NOT NULL REFERENCES feed.boost (campaign_id),
  region          text        NOT NULL CHECK (region IN ('AU', 'ID')),
  day             date        NOT NULL,
  slot            integer     NOT NULL CHECK (slot >= 0),
  price_cpm_minor bigint      NOT NULL CHECK (price_cpm_minor > 0),
  served_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX boost_impression_campaign_day_idx ON feed.boost_impression (campaign_id, day);

-- A closed day's spend, charged once through the payment driver.
CREATE TABLE feed.boost_charge (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        uuid        NOT NULL REFERENCES feed.boost (campaign_id),
  business_id        uuid        NOT NULL,
  region             text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency           text        NOT NULL CHECK (currency IN ('AUD', 'IDR')),
  day                date        NOT NULL,
  impressions        integer     NOT NULL CHECK (impressions > 0),
  amount_minor       bigint      NOT NULL CHECK (amount_minor > 0),
  provider_reference text        NOT NULL,
  charged_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boost_charge_once UNIQUE (campaign_id, day),
  CONSTRAINT boost_charge_currency_matches_region CHECK ((region = 'AU') = (currency = 'AUD'))
);
CREATE INDEX boost_charge_business_idx ON feed.boost_charge (business_id, day DESC);

GRANT SELECT, INSERT, UPDATE ON feed.boost, feed.boost_spend_day TO yourtal_app;
GRANT SELECT, INSERT ON feed.boost_impression, feed.boost_charge TO yourtal_app;

-- The floor price per 1,000 boosted impressions, per region (F12: an economy
-- number lives in the settings store, editable with two-person approval).
INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from) VALUES
  ('AU', 'boost_reserve_cpm', '{"cpmMinor": 100, "currency": "AUD"}'::jsonb, 'founder', 'plan-f86', now()),
  ('ID', 'boost_reserve_cpm', '{"cpmMinor": 5000, "currency": "IDR"}'::jsonb, 'founder', 'plan-f86', now());
