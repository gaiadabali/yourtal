-- Group 2.10.b, F127 (docs/27 §3.6, migration A): SnapApp's receipt package.
-- A partner's funder business buys receipt points at cost (exactly B); each
-- package is a `partner` allocation plus a row here, written in the
-- purchase's transaction and never changed. Add-only: nothing reads these
-- yet, and receipts keep their marketing funding until migration B.

CREATE TABLE ledger.receipt_package (
  allocation_id text        PRIMARY KEY REFERENCES ledger.allocation (id),
  purchase_id   text        NOT NULL UNIQUE REFERENCES ledger.point_purchase (id),
  funder_id     text        NOT NULL,
  region        text        NOT NULL CHECK (region IN ('AU', 'ID')),
  rate_id       text        NOT NULL REFERENCES ledger.backing_rate (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A funder's packages with room, oldest first (the receipt draw's order).
CREATE INDEX receipt_package_funder_idx
  ON ledger.receipt_package (funder_id, region, created_at, allocation_id);

-- created_at orders the draw, so it is the database's clock (EM-18).
CREATE TRIGGER receipt_package_stamp_now BEFORE INSERT ON ledger.receipt_package
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();

GRANT SELECT, INSERT ON ledger.receipt_package TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.receipt_package FROM yourtal_ledger;
REVOKE ALL ON ledger.receipt_package FROM yourtal_app;

ALTER TABLE ledger.receipt_package ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.receipt_package
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

-- K6 for at-cost points, in the database so it holds even if the Go pricing
-- is wrong: a package is the funder's own partner allocation in its region,
-- bought by its own purchase of exactly the allocation's points, in the
-- region's currency, priced at the backing rate in force, and paid at least
-- points × B. Checked at COMMIT, once the whole purchase exists.
CREATE FUNCTION ledger.assert_receipt_package() RETURNS trigger AS $$
DECLARE
  alloc     ledger.allocation;
  purchase  ledger.point_purchase;
  rate      ledger.backing_rate;
  want_currency char(3) := CASE NEW.region WHEN 'AU' THEN 'AUD' WHEN 'ID' THEN 'IDR' END;
  in_force  text;
BEGIN
  SELECT * INTO alloc FROM ledger.allocation WHERE id = NEW.allocation_id;
  IF NOT FOUND OR alloc.funder_type <> 'partner' OR alloc.funder_id <> NEW.funder_id
     OR alloc.region IS DISTINCT FROM NEW.region THEN
    RAISE EXCEPTION 'ledger: receipt package % is not a % partner allocation of %',
      NEW.allocation_id, NEW.region, NEW.funder_id USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO purchase FROM ledger.point_purchase WHERE id = NEW.purchase_id;
  IF NOT FOUND OR purchase.allocation_id <> NEW.allocation_id OR purchase.partner_id <> NEW.funder_id
     OR purchase.points <> alloc.total_points THEN
    RAISE EXCEPTION 'ledger: receipt package % is not what purchase % bought',
      NEW.allocation_id, NEW.purchase_id USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO rate FROM ledger.backing_rate WHERE id = NEW.rate_id;
  SELECT r.id INTO in_force
    FROM ledger.backing_rate r JOIN ledger.backing_rate_approval a ON a.rate_id = r.id
   WHERE r.currency = want_currency AND a.effective_from <= now()
   ORDER BY a.effective_from DESC, a.approved_at DESC
   LIMIT 1;
  IF NOT FOUND OR rate.currency <> want_currency OR purchase.currency <> want_currency
     OR in_force IS DISTINCT FROM NEW.rate_id THEN
    RAISE EXCEPTION 'ledger: receipt package % is not priced at the % rate in force',
      NEW.allocation_id, want_currency USING ERRCODE = 'check_violation';
  END IF;

  IF purchase.amount_minor::numeric * 1000000 < purchase.points::numeric * rate.micros_per_point THEN
    RAISE EXCEPTION 'ledger: receipt package % paid % for % points, below B',
      NEW.allocation_id, purchase.amount_minor, purchase.points USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER receipt_package_backed_at_commit
  AFTER INSERT ON ledger.receipt_package
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_receipt_package();

-- The ledger reads each partner's receipt funder (F127). Same columns, so
-- CREATE OR REPLACE is safe, as in 20261020173615.
CREATE OR REPLACE VIEW platform.ledger_setting AS
  SELECT DISTINCT ON (region, key) region, key, value, effective_from
    FROM platform.region_setting
   WHERE approved_by IS NOT NULL
     AND effective_from <= now()
     AND (key IN (
       'daily_earn_cap', 'teen_daily_earn_cap', 'monthly_earn_cap',
       'holdback_hours_by_tier', 'streak_coverage_pause_threshold',
       'streak_bonus_points', 'receipt_points', 'goodwill_case_limit_points',
       'marketing_budget', 'points_pack', 'settlement_dispute_window_days',
       'points_expiry', 'point_package_tiers'
     ) OR starts_with(key, 'receipt_funder.'))
   ORDER BY region, key, effective_from DESC;

-- A Studio purchase of a receipt package; null for every other purchase.
-- A receipt package is always a tier's size, so it names its tier.
ALTER TABLE payment.card_purchase
  ADD COLUMN programme text CHECK (programme IN ('receipts'));
ALTER TABLE payment.card_purchase
  ADD CONSTRAINT card_purchase_programme_needs_tier CHECK (programme IS NULL OR tier_key IS NOT NULL);

-- The alert sweep words a receipt package's alerts for the funder.
ALTER TABLE payment.budget_alert
  ADD COLUMN programme text CHECK (programme IN ('receipts'));

-- The api's fake ledger keeps the same fact for its allocations.
ALTER TABLE platform.ledger_fake_allocation
  ADD COLUMN programme text CHECK (programme IN ('receipts'));
