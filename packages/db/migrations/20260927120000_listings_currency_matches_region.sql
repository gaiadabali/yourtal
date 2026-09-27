-- TASKS.md 7.4.f: store.listings got region/audience/category CHECKs in
-- 20260925190000, but never the currency-matches-region one that
-- business_accounts got the same day (business_accounts_currency_matches_region).
-- A listing's currency and region already always agree in practice --
-- create-listing.use-case.ts derives both from the owning business -- but
-- that is an application-layer promise, not a database one (F2: the region
-- wall belongs in the database too, not only Cerbos and the API).
ALTER TABLE store.listings
  ADD CONSTRAINT listings_currency_matches_region CHECK (
    (region = 'AU' AND currency = 'AUD') OR (region = 'ID' AND currency = 'IDR')
  );
