-- 1.2.f (F12, F23): per-region economy settings, so a number the plan wrote
-- down ("best mechanics for now") is a row a staff console can change later,
-- never a constant a deploy has to ship to move.
--
-- One table, both regions in it (F2's "one system with hard walls"): each
-- row is CHECKed into exactly AU or ID, the same shape `platform.sim_outbox`
-- already uses for a platform-wide table that still respects the region
-- wall per row rather than per schema.
--
-- ## Propose/approve lives in ONE row, not two tables
--
-- `ledger.backing_rate` / `backing_rate_approval` (20260925183000) splits
-- proposal and approval into two append-only tables. This table does not,
-- because 1.2.f's own spec names the columns as a single row --
-- `(region, key, value, set_by, approved_by, effective_from)` -- and a
-- setting change is a request that is either still pending or has been
-- decided, not two independent facts. So: `proposeSetting` is a plain
-- INSERT with `approved_by`/`effective_from` NULL; `approveSetting` is an
-- UPDATE that fills them in. The trigger below makes that UPDATE the only
-- kind this table ever accepts, freezes a row the moment it is decided, and
-- refuses the one case a client could otherwise get wrong: approving your
-- own proposal.
CREATE TABLE platform.region_setting (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  region         text        NOT NULL,
  key            text        NOT NULL,
  value          jsonb       NOT NULL,
  set_by         text        NOT NULL,
  approved_by    text,
  effective_from timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT region_setting_region_known CHECK (region IN ('AU', 'ID')),

  -- Two-person rule (F23, docs/17 section 2.1's separation of duties): the
  -- one CEL-side check (`platform_setting.yaml`) gets a database-side twin,
  -- the same belt-and-braces move `backing_rate_approval`'s trigger makes
  -- for F1 -- an approval is worth nothing if only the API remembers to ask.
  CONSTRAINT region_setting_two_person CHECK (approved_by IS NULL OR approved_by <> set_by),

  -- A proposal has neither; a decision has both. There is no third state.
  CONSTRAINT region_setting_approval_consistency CHECK ((approved_by IS NULL) = (effective_from IS NULL)),

  -- Same rule `backing_rate_not_backdated` states for rates: a setting never
  -- takes effect before it was proposed, on the database's own clock.
  CONSTRAINT region_setting_not_backdated CHECK (effective_from IS NULL OR effective_from >= created_at)
);

-- getSetting(region, key) wants "the current value", which is the most
-- recently effective approved row -- this index is exactly that query's
-- access path. Unapproved proposals (effective_from IS NULL) are never in
-- it, so a pending change can never leak into a read before someone signs
-- off on it.
CREATE INDEX region_setting_current_idx
  ON platform.region_setting (region, key, effective_from DESC)
  WHERE approved_by IS NOT NULL;

-- Finds a business user's or staff member's own still-pending proposals,
-- and backs the "nobody approves their own" check at the application layer
-- without a table scan.
CREATE INDEX region_setting_pending_idx
  ON platform.region_setting (region, key)
  WHERE approved_by IS NULL;

CREATE FUNCTION platform.region_setting_approval_rules() RETURNS trigger AS $$
BEGIN
  -- Once a setting is decided it is history, like `backing_rate`'s rows --
  -- proposeSetting always starts a new row, so there is never a reason for
  -- an approved one to change again.
  IF OLD.approved_by IS NOT NULL THEN
    RAISE EXCEPTION 'platform: region_setting % is already approved and cannot be edited; propose a new change instead', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.approved_by IS NOT NULL THEN
    IF NEW.approved_by = OLD.set_by THEN
      RAISE EXCEPTION 'platform: % proposed region_setting %; a different person must approve it', OLD.set_by, OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    -- Stamped by the database, not accepted from the caller -- the same
    -- reason `backing_rate_stamp_now` exists: an approval that could name
    -- its own effective time could also name one in the past.
    NEW.effective_from := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER region_setting_approval_rules BEFORE UPDATE ON platform.region_setting
  FOR EACH ROW EXECUTE FUNCTION platform.region_setting_approval_rules();

GRANT SELECT, INSERT, UPDATE ON platform.region_setting TO yourtal_app;
REVOKE DELETE ON platform.region_setting FROM yourtal_app;

-- The Go ledger reads its own keys (caps, holdback, coverage thresholds,
-- marketing limits) through a VIEW, not the table -- the same least-
-- privilege shape 20260922020000 uses for `campaign.reward_config`: one
-- narrow, read-only surface rather than schema-wide USAGE plus a table the
-- engine could also propose or approve changes through. `DISTINCT ON`
-- picks the latest effective row per (region, key), so the engine always
-- reads one current value, never a history it would have to reduce itself.
CREATE VIEW platform.ledger_setting AS
  SELECT DISTINCT ON (region, key) region, key, value, effective_from
    FROM platform.region_setting
   WHERE approved_by IS NOT NULL
     AND effective_from <= now()
     AND key IN (
       'daily_earn_cap', 'teen_daily_earn_cap', 'monthly_earn_cap',
       'holdback_hours_by_tier', 'streak_coverage_pause_threshold',
       'streak_bonus_points', 'receipt_points', 'goodwill_case_limit_points',
       'marketing_budget', 'points_pack', 'settlement_dispute_window_days'
     )
   ORDER BY region, key, effective_from DESC;

GRANT USAGE ON SCHEMA platform TO yourtal_ledger;
GRANT SELECT ON platform.ledger_setting TO yourtal_ledger;

-- F12's defaults, seeded pre-approved the same way 20260925183000 seeds
-- F1's rates ('plan-f1' as the second signature) -- these are the plan's own
-- numbers, not a proposal awaiting a person, so `set_by`/`approved_by` name
-- the plan rather than pretending two staff members signed off on day one.
-- Every value that is money carries its minor units AND its currency
-- (CLAUDE.md's money rule); every other value is a plain number or a small
-- object, whichever the setting actually is.
INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from) VALUES
  -- Reward ceiling per minute, INCLUDING the max accuracy bonus (F14): base +
  -- bonus must fit under this so 20 min in AU stays under AUD 5.
  ('AU', 'reward_ceiling_points_per_minute', '8'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'reward_ceiling_points_per_minute', '150'::jsonb, 'founder', 'plan-f12', now()),

  ('AU', 'demo_reward_points_per_minute', '5'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'demo_reward_points_per_minute', '80'::jsonb, 'founder', 'plan-f12', now()),

  -- J10: the demo's accuracy bonus is 25%, capped at 40% of base -- same
  -- shape both regions, so one row each rather than a region-agnostic key.
  ('AU', 'demo_accuracy_bonus', '{"pct": 25, "maxOfBasePct": 40}'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'demo_accuracy_bonus', '{"pct": 25, "maxOfBasePct": 40}'::jsonb, 'founder', 'plan-f12', now()),

  -- A streak day pays on day 3 and day 7 (F16 picks whose clock).
  ('AU', 'streak_bonus_points', '{"day3": 5, "day7": 10}'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'streak_bonus_points', '{"day3": 60, "day7": 120}'::jsonb, 'founder', 'plan-f12', now()),

  -- Coverage ratio below which the streak bonus is paused (both regions).
  ('AU', 'streak_coverage_pause_threshold', '1.1'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'streak_coverage_pause_threshold', '1.1'::jsonb, 'founder', 'plan-f12', now()),

  -- snap-app receipt reward, one per receipt hash per partner.
  ('AU', 'receipt_points', '10'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'receipt_points', '100'::jsonb, 'founder', 'plan-f12', now()),

  -- Daily earn cap. Teens get half of it (F12); stored explicitly, not
  -- derived, so a reader never has to know the halving rule to use it.
  ('AU', 'daily_earn_cap', '500'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'daily_earn_cap', '5000'::jsonb, 'founder', 'plan-f12', now()),
  ('AU', 'teen_daily_earn_cap', '250'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'teen_daily_earn_cap', '2500'::jsonb, 'founder', 'plan-f12', now()),

  -- Monthly cap = 30x the daily cap (F12), stored explicitly for the same
  -- reason the teen cap is.
  ('AU', 'monthly_earn_cap', '15000'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'monthly_earn_cap', '150000'::jsonb, 'founder', 'plan-f12', now()),

  -- Holdback by trust tier, in hours. Tier 3 (0h) is staff-set only and
  -- covers demo viewer accounts (F12); same both regions.
  ('AU', 'holdback_hours_by_tier', '{"tier0": 72, "tier1": 48, "tier2": 24, "tier3": 0}'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'holdback_hours_by_tier', '{"tier0": 72, "tier1": 48, "tier2": 24, "tier3": 0}'::jsonb, 'founder', 'plan-f12', now()),

  ('AU', 'goodwill_case_limit_points', '500'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'goodwill_case_limit_points', '5000'::jsonb, 'founder', 'plan-f12', now()),

  -- Money: integer minor units plus a currency, per CLAUDE.md's rule. AUD is
  -- exponent 2 (AUD 5,000.00 -> 500000 minor units); IDR is exponent 0
  -- (IDR 50,000,000 is already whole Rupiah).
  ('AU', 'marketing_budget', '{"amountMinor": 500000, "currency": "AUD"}'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'marketing_budget', '{"amountMinor": 50000000, "currency": "IDR"}'::jsonb, 'founder', 'plan-f12', now()),

  -- Points packs: F1's P_issue applies at purchase time (7.5.a); this is the
  -- catalogue unit shown in Studio -- 1,000 pts per pack.
  ('AU', 'points_pack', '{"points": 1000, "priceMinor": 4500, "currency": "AUD"}'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'points_pack', '{"points": 1000, "priceMinor": 9000, "currency": "IDR"}'::jsonb, 'founder', 'plan-f12', now()),

  ('AU', 'settlement_dispute_window_days', '7'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'settlement_dispute_window_days', '7'::jsonb, 'founder', 'plan-f12', now()),

  -- Reporting cohort floors: never show a group smaller than this (teens
  -- get a higher floor). Same both regions.
  ('AU', 'cohort_floor_min_group', '{"default": 10, "teen": 20}'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'cohort_floor_min_group', '{"default": 10, "teen": 20}'::jsonb, 'founder', 'plan-f12', now()),

  -- Interest-targeting minimum segment. F12 notes "staging: 1" as an
  -- environment override for 2.3's seed, not a second region value, so the
  -- plan's own number is seeded here; Phase 2's staging seed may propose and
  -- approve a lower value the same way any other setting change would.
  ('AU', 'interest_targeting_min_segment', '1000'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'interest_targeting_min_segment', '1000'::jsonb, 'founder', 'plan-f12', now()),

  ('AU', 'open_viewing_daily_minutes_per_ip', '60'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'open_viewing_daily_minutes_per_ip', '60'::jsonb, 'founder', 'plan-f12', now()),
  ('AU', 'open_viewing_max_concurrent_sessions', '1'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'open_viewing_max_concurrent_sessions', '1'::jsonb, 'founder', 'plan-f12', now()),

  ('AU', 'session_consumer_sliding_days', '30'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'session_consumer_sliding_days', '30'::jsonb, 'founder', 'plan-f12', now()),
  ('AU', 'session_consumer_absolute_days', '90'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'session_consumer_absolute_days', '90'::jsonb, 'founder', 'plan-f12', now()),
  ('AU', 'session_staff_hours', '12'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'session_staff_hours', '12'::jsonb, 'founder', 'plan-f12', now()),

  ('AU', 'teen_quiet_hours', '{"start": "21:00", "end": "07:00"}'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'teen_quiet_hours', '{"start": "21:00", "end": "07:00"}'::jsonb, 'founder', 'plan-f12', now()),

  -- F2/F18: off in both regions, for good, but built and switchable per
  -- region -- exactly the shape this table exists to hold.
  ('AU', 'points_expiry', '{"enabled": false, "inactivityMonths": 12}'::jsonb, 'founder', 'plan-f12', now()),
  ('ID', 'points_expiry', '{"enabled": false, "inactivityMonths": 12}'::jsonb, 'founder', 'plan-f12', now());
