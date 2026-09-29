-- 10.7: fake-ledger parity with the real one's K6 rule (4.4.h).
--
-- `platform.ledger_fake_marketing_fund` already records every funding
-- decision (a credit); this is the debit side `backMarketingGrant` posts in
-- services/ledger, so a fake region's REMAINING marketing cash is
-- SUM(fund) - SUM(backing), the same shape the real ledger's own
-- marketing_cash account balance is.
CREATE TABLE platform.ledger_fake_marketing_backing (
  id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  region       text        NOT NULL CHECK (region IN ('AU', 'ID')),
  grant_id     text        NOT NULL REFERENCES platform.ledger_fake_grant (id),
  amount_minor bigint      NOT NULL CHECK (amount_minor > 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.ledger_fake_marketing_backing TO yourtal_app;

-- 10.7.b: region-tagged burns, so economyDaily's pointsRedeemed is real
-- instead of always 0. Nullable like ledger.allocation.region (existing
-- rows predate this and carry no region; nothing reads them as AU or ID).
ALTER TABLE platform.ledger_fake_burn ADD COLUMN region text CHECK (region IN ('AU', 'ID'));
