-- YT-0502: a merchant has branches, and a voucher names which one honours it.
--
-- Replaces `store.listings.district`, a single string that could describe
-- only one outlet. A multi-branch merchant could not be represented at all,
-- and "which branch honours this voucher" — load-bearing for redemption and
-- for disputes — had no answer.
--
-- Modelled as tables rather than a jsonb column on the listing. jsonb would
-- have matched the Zod shape more directly and bought nothing: the point of
-- the database layer is the integrity a fixture cannot have, and the
-- constraint at the bottom of this file is only expressible relationally.

CREATE TABLE store.merchant_location (
  id          uuid        PRIMARY KEY,
  merchant_id uuid        NOT NULL,
  name        text        NOT NULL,
  address     text        NOT NULL,
  district    text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX merchant_location_merchant_idx ON store.merchant_location (merchant_id);

-- Which branches honour a given listing. A listing must offer at least one,
-- which `listingSchema`'s `.min(1)` says on the TypeScript side; a table
-- cannot express "at least one row" as a constraint, so that half stays with
-- Zod and the seed test asserts it holds for real data.
CREATE TABLE store.listing_location (
  listing_id  uuid NOT NULL REFERENCES store.listings (id),
  location_id uuid NOT NULL REFERENCES store.merchant_location (id),
  PRIMARY KEY (listing_id, location_id)
);

-- The voucher names the branch that honours it, chosen at issuance.
ALTER TABLE voucher.vouchers ADD COLUMN location_id uuid;

-- Backfill is not possible: existing rows predate locations entirely and
-- there is no branch to attribute them to. The seed is the only source of
-- vouchers today, so they are cleared rather than guessed — inventing a
-- location for a voucher would be inventing where someone can spend it.
DELETE FROM voucher.vouchers WHERE location_id IS NULL;

ALTER TABLE voucher.vouchers ALTER COLUMN location_id SET NOT NULL;

-- THE constraint this modelling exists for: a voucher's branch must be one
-- its own listing actually offers.
--
-- A plain FK to merchant_location would allow a voucher for listing L that
-- names a branch L does not serve — the customer is sent to a shop that has
-- never heard of the offer, and nothing in the system objects. The composite
-- FK makes that unrepresentable, because `vouchers` already carries
-- `listing_id` and the pair must exist in `listing_location`.
ALTER TABLE voucher.vouchers
  ADD CONSTRAINT vouchers_location_is_offered_by_its_listing
  FOREIGN KEY (listing_id, location_id)
  REFERENCES store.listing_location (listing_id, location_id);

-- `district` was the single-outlet assumption. It now lives per location.
ALTER TABLE store.listings DROP COLUMN district;

GRANT SELECT, INSERT, UPDATE, DELETE ON store.merchant_location TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON store.listing_location  TO yourtal_app;
