-- 14.13 (F121, F122): point packages in tiers, and budget alerts at 50%, 80%
-- and 100% of a package or a campaign budget.

-- The ledger prices every tier itself, so it reads the catalogue: widen its
-- settings view's key list by one. Same columns, so CREATE OR REPLACE is safe
-- (20260929070400 did the same for points_expiry).
CREATE OR REPLACE VIEW platform.ledger_setting AS
  SELECT DISTINCT ON (region, key) region, key, value, effective_from
    FROM platform.region_setting
   WHERE approved_by IS NOT NULL
     AND effective_from <= now()
     AND key IN (
       'daily_earn_cap', 'teen_daily_earn_cap', 'monthly_earn_cap',
       'holdback_hours_by_tier', 'streak_coverage_pause_threshold',
       'streak_bonus_points', 'receipt_points', 'goodwill_case_limit_points',
       'marketing_budget', 'points_pack', 'settlement_dispute_window_days',
       'points_expiry', 'point_package_tiers'
     )
   ORDER BY region, key, effective_from DESC;

-- F122's tiers, seeded pre-approved like F12's defaults. Sizes in points and
-- discounts in basis points off P_issue; the ledger refuses any tier whose
-- price per point would fall below B (K6). ID keeps the same sizes (F104).
INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from) VALUES
  ('AU', 'point_package_tiers',
   '[{"key": "starter", "points": 1000, "discountBps": 0}, {"key": "grow", "points": 10000, "discountBps": 500}, {"key": "scale", "points": 50000, "discountBps": 1000}]'::jsonb,
   'founder', 'plan-f122', now()),
  ('ID', 'point_package_tiers',
   '[{"key": "starter", "points": 1000, "discountBps": 0}, {"key": "grow", "points": 10000, "discountBps": 500}, {"key": "scale", "points": 50000, "discountBps": 1000}]'::jsonb,
   'founder', 'plan-f122', now());

-- The tier a Studio purchase was priced at; null for a purchase made before
-- tiers. The ledger re-prices the tier when the payment lands.
ALTER TABLE payment.card_purchase ADD COLUMN tier_key text;

-- One row per alert sent: a package (a ledger allocation the business bought)
-- or a campaign's total budget, at 50, 80 or 100% used. The unique key makes
-- each alert once only, whoever runs the sweep. notified_at is set once the
-- business has been told, by this alert or a higher one found in the same
-- sweep; a row left unset is emailed again on the next sweep.
CREATE TABLE payment.budget_alert (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid        NOT NULL,
  region        text        NOT NULL CHECK (region IN ('AU', 'ID')),
  subject_kind  text        NOT NULL CHECK (subject_kind IN ('package', 'campaign')),
  subject_id    text        NOT NULL,
  threshold_pct smallint    NOT NULL CHECK (threshold_pct IN (50, 80, 100)),
  used_points   bigint      NOT NULL CHECK (used_points >= 0),
  total_points  bigint      NOT NULL CHECK (total_points > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  notified_at   timestamptz,
  CONSTRAINT budget_alert_once UNIQUE (subject_kind, subject_id, threshold_pct)
);
CREATE INDEX budget_alert_business_idx ON payment.budget_alert (business_id, created_at DESC);
CREATE INDEX budget_alert_unnotified_idx ON payment.budget_alert (created_at) WHERE notified_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON payment.budget_alert TO yourtal_app;

ALTER TABLE payment.budget_alert ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON payment.budget_alert
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));
