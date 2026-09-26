-- 4.10: the AU/ID wall in the database, not only in code (F2). Each rule
-- below was enforced only by Go until now. NOT VALID: every new row is
-- checked; history is append-only and stays as it is.

-- A quote or listing price is priced at a rate of its own currency, so an
-- AU price can never be computed from the ID backing rate.
ALTER TABLE ledger.backing_rate
  ADD CONSTRAINT backing_rate_id_currency_key UNIQUE (id, currency);
ALTER TABLE ledger.quote
  ADD CONSTRAINT quote_rate_in_its_currency
    FOREIGN KEY (backing_rate_id, currency) REFERENCES ledger.backing_rate (id, currency) NOT VALID;
ALTER TABLE ledger.listing_price
  ADD CONSTRAINT listing_price_rate_in_its_currency
    FOREIGN KEY (backing_rate_id, currency) REFERENCES ledger.backing_rate (id, currency) NOT VALID;

-- A voucher's region is its currency's, and its currency is its listing's.
ALTER TABLE voucher.vouchers
  ADD CONSTRAINT vouchers_cash_in_its_region
    CHECK ((currency = 'AUD' AND region = 'AU') OR (currency = 'IDR' AND region = 'ID')) NOT VALID;
ALTER TABLE voucher.vouchers
  ADD CONSTRAINT vouchers_in_their_listings_currency
    FOREIGN KEY (listing_id, currency) REFERENCES store.listings (id, currency) NOT VALID;

-- The regions a set of transfers posts to, read from the accounts they touch.
CREATE FUNCTION ledger.transfer_regions(ids text[]) RETURNS text[]
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT a.country), '{}')
  FROM ledger.entry e JOIN ledger.account a ON a.id = e.account_id
  WHERE e.transfer_id = ANY (ids)
$$;

-- A grant, a purchase or a burn lives in one region: its own, its
-- allocation's, and that of every account its transfers post to. Checked at
-- commit, once the transfers' entries exist.
CREATE FUNCTION ledger.assert_in_one_region() RETURNS trigger AS $$
DECLARE
  regions text[];
  row_id  text;
BEGIN
  IF TG_TABLE_NAME = 'grant' THEN
    row_id := NEW.id;
    regions := ledger.transfer_regions(ARRAY[NEW.transfer_id])
      || ARRAY[NEW.region]
      || ARRAY(SELECT region FROM ledger.allocation WHERE id = NEW.allocation_id);
  ELSIF TG_TABLE_NAME = 'point_purchase' THEN
    row_id := NEW.id;
    regions := ledger.transfer_regions(ARRAY[NEW.cash_transfer_id])
      || ARRAY[CASE NEW.currency WHEN 'AUD' THEN 'AU' WHEN 'IDR' THEN 'ID' END]
      || ARRAY(SELECT region FROM ledger.allocation WHERE id = NEW.allocation_id);
  ELSE -- burn
    row_id := NEW.saga_id;
    regions := ledger.transfer_regions(ARRAY[NEW.points_transfer_id, NEW.liability_transfer_id])
      || ARRAY[NEW.region];
  END IF;
  IF (SELECT count(DISTINCT r) FROM unnest(regions) AS r WHERE r IS NOT NULL) > 1 THEN
    RAISE EXCEPTION 'ledger: % % crosses regions', TG_TABLE_NAME, row_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER grant_in_one_region AFTER INSERT ON ledger.grant
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_in_one_region();
CREATE CONSTRAINT TRIGGER point_purchase_in_one_region AFTER INSERT ON ledger.point_purchase
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_in_one_region();
CREATE CONSTRAINT TRIGGER burn_in_one_region AFTER INSERT ON ledger.burn
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_in_one_region();

-- EM-19: a quote lives 15 minutes from the database's clock (created_at is
-- stamped now() before this is checked), so no writer can extend a price.
ALTER TABLE ledger.quote
  ADD CONSTRAINT quote_lives_fifteen_minutes
    CHECK (expires_at <= created_at + interval '15 minutes') NOT VALID;
