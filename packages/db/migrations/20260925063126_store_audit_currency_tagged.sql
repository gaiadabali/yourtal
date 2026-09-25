-- Finishes currency-tagged money for the two store audit tables that
-- 20260922030000 left on `_idr` names. Each row carries its listing's
-- currency, and a composite foreign key keeps it that way: an audit row can
-- never record a price in a different currency from the listing it prices.

ALTER TABLE store.listings
  ADD CONSTRAINT listings_id_currency_key UNIQUE (id, currency);

ALTER TABLE store.listing_price_revision
  RENAME COLUMN previous_settlement_value_idr TO previous_settlement_value_minor;
ALTER TABLE store.listing_price_revision
  RENAME COLUMN new_settlement_value_idr TO new_settlement_value_minor;
ALTER TABLE store.listing_price_revision ADD COLUMN currency text;
UPDATE store.listing_price_revision r
   SET currency = l.currency
  FROM store.listings l
 WHERE l.id = r.listing_id;
ALTER TABLE store.listing_price_revision ALTER COLUMN currency SET NOT NULL;
ALTER TABLE store.listing_price_revision
  ADD CONSTRAINT listing_price_revision_listing_currency_fkey
  FOREIGN KEY (listing_id, currency) REFERENCES store.listings (id, currency);

ALTER TABLE store.settlement_decrease_request
  RENAME COLUMN current_settlement_value_idr TO current_settlement_value_minor;
ALTER TABLE store.settlement_decrease_request
  RENAME COLUMN proposed_settlement_value_idr TO proposed_settlement_value_minor;
ALTER TABLE store.settlement_decrease_request ADD COLUMN currency text;
UPDATE store.settlement_decrease_request d
   SET currency = l.currency
  FROM store.listings l
 WHERE l.id = d.listing_id;
ALTER TABLE store.settlement_decrease_request ALTER COLUMN currency SET NOT NULL;
ALTER TABLE store.settlement_decrease_request
  ADD CONSTRAINT settlement_decrease_request_listing_currency_fkey
  FOREIGN KEY (listing_id, currency) REFERENCES store.listings (id, currency);
