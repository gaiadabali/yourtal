-- YT-0513 · the wire migration: money amounts carry their currency.
--
-- `face_value_idr` and its siblings name a currency they do not always
-- hold. `region-mock-au-listing.ts` stores AUD cents in a field typed
-- `IdrMinorUnits` and renders correctly only because every call site
-- remembers to pass "AUD" -- its own header calls that the known IDR-field
-- wart. This migration removes the possibility rather than the instance.
--
-- ONE CURRENCY PER ROW, not one per amount. Three currency columns would
-- permit a listing whose face value is AUD and whose settlement value is
-- IDR; nothing would reject it, and `B = S / price_in_points` would
-- silently compute across two currencies. A single column makes that
-- unrepresentable -- the argument `moneySchema` makes about a transfer not
-- mixing currencies, one level up.
--
-- NO DEFAULT ON `currency`, DELIBERATELY. A `DEFAULT 'IDR'` is the
-- schema-level form of a one-argument `fromLegacyAmount`: it would relabel
-- every existing row as Rupiah with the database's approval, and the AU
-- rows are exactly the ones that would be wrong. The backfill below names
-- what it is doing; anything it does not name fails loudly on the NOT NULL.

BEGIN;

-- ---------------------------------------------------------------------------
-- Re-assert the precondition rather than inheriting it.
--
-- 20260920000011_idr_sen.sql checked that no AU-merchant catalogue row
-- existed and refused rather than corrupting one. That was true WHEN IT WAS
-- WRITTEN. Backfilling 'IDR' on the strength of that check would trust a
-- fact about the data older than the data, and the failure is silent: a
-- mislabelled row is still a valid row. So the check runs again, here,
-- against the rows this migration is about to touch.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- The AU merchants from packages/contracts/src/merchant/merchant-roster.ts,
  -- copied from 20260920000011_idr_sen.sql's own guard. There is no
  -- merchants TABLE -- the roster lives in code -- so the ids are named
  -- here, and that is precisely why the check has to be re-run rather than
  -- inherited: a roster entry added since is invisible to the old list.
  au_merchants uuid[] := ARRAY[
    '00000000-0000-4000-8000-000000000603',  -- Sydney CBD Cafe
    '00000000-0000-4000-8000-0000000006a1',  -- Wharf Espresso Co
    '00000000-0000-4000-8000-0000000006a2',  -- (long AU name)
    '00000000-0000-4000-8000-0000000006a3'   -- Cedar Deli Bar
  ]::uuid[];
  offenders bigint;
BEGIN
  SELECT (SELECT count(*) FROM store.listings   WHERE merchant_id = ANY(au_merchants))
       + (SELECT count(*) FROM voucher.vouchers WHERE merchant_id = ANY(au_merchants))
    INTO offenders;

  IF offenders > 0 THEN
    RAISE EXCEPTION
      'YT-0513: % row(s) belong to AU merchants, whose amounts are AUD cents. The backfill below sets every row to IDR, which would mislabel them. Backfill those rows to AUD explicitly, then re-run.',
      offenders;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- store.listings
-- ---------------------------------------------------------------------------
ALTER TABLE store.listings RENAME COLUMN face_value_idr TO face_value_minor;
ALTER TABLE store.listings RENAME COLUMN settlement_value_idr TO settlement_value_minor;
ALTER TABLE store.listings RENAME COLUMN minimum_spend_idr TO minimum_spend_minor;

ALTER TABLE store.listings ADD COLUMN currency text;
UPDATE store.listings SET currency = 'IDR';
ALTER TABLE store.listings ALTER COLUMN currency SET NOT NULL;
ALTER TABLE store.listings
  ADD CONSTRAINT listings_currency_known CHECK (currency IN ('IDR', 'AUD'));

-- ---------------------------------------------------------------------------
-- voucher.vouchers
-- ---------------------------------------------------------------------------
ALTER TABLE voucher.vouchers RENAME COLUMN face_value_idr TO face_value_minor;
ALTER TABLE voucher.vouchers RENAME COLUMN remaining_value_idr TO remaining_value_minor;
ALTER TABLE voucher.vouchers RENAME COLUMN minimum_spend_idr TO minimum_spend_minor;

ALTER TABLE voucher.vouchers ADD COLUMN currency text;
UPDATE voucher.vouchers SET currency = 'IDR';
ALTER TABLE voucher.vouchers ALTER COLUMN currency SET NOT NULL;
ALTER TABLE voucher.vouchers
  ADD CONSTRAINT vouchers_currency_known CHECK (currency IN ('IDR', 'AUD'));

COMMIT;
