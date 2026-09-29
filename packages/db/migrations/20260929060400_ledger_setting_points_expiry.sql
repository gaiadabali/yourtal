-- TASKS.md 10.2.a: platform.ledger_setting (20260925193000) scopes the
-- ledger's read of platform.region_setting to a fixed key allowlist --
-- least privilege, the same reasoning campaign.reward_config's own read-only
-- grant uses. points_expiry was never added to that list because nothing on
-- the ledger side read it before this task. CREATE OR REPLACE is safe here:
-- the column list and types are unchanged, only the WHERE clause's allowed
-- keys widen.
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
       'points_expiry'
     )
   ORDER BY region, key, effective_from DESC;
