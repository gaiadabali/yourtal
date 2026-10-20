-- 14.2 (group 1.6): a campaign's total budget, daily cap and target districts
-- are saved and enforced.
--
-- The total budget is reward_config.max_points_for_campaign, in points: a
-- campaign is funded from its business's purchased (cash-backed, K6) point
-- allocation, and the ledger already stops its grants at that ceiling under a
-- per-campaign lock (4.4.a-c). The daily cap sits beside it, in points too.

ALTER TABLE campaign.reward_config
  ADD COLUMN daily_cap_points bigint
    CONSTRAINT reward_config_daily_cap_positive CHECK (daily_cap_points IS NULL OR daily_cap_points > 0);
ALTER TABLE campaign.reward_config
  ADD CONSTRAINT reward_config_daily_cap_within_budget
    CHECK (daily_cap_points IS NULL OR daily_cap_points <= max_points_for_campaign);

-- Districts the campaign is shown in. Empty means every district.
ALTER TABLE campaign.campaigns
  ADD COLUMN target_districts jsonb NOT NULL DEFAULT '[]'
    CONSTRAINT campaigns_target_districts_array CHECK (jsonb_typeof(target_districts) = 'array');

-- Which session holds reserve room in which campaign. A hold is taken at
-- session start under the campaign's lock and counted against its budget and
-- today's cap while it is live, so a viewer who starts earning is never
-- refused at the end for a budget that other sessions spent meanwhile.
CREATE TABLE ledger.campaign_hold (
  hold_id     text        PRIMARY KEY REFERENCES ledger.allocation_hold (id),
  campaign_id uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaign_hold_campaign_idx ON ledger.campaign_hold (campaign_id);
GRANT SELECT, INSERT ON ledger.campaign_hold TO yourtal_ledger;

-- A campaign's spend, in all and today, is summed on every hold and grant.
CREATE INDEX grant_campaign_day_idx ON ledger.grant (campaign_id, created_at)
  WHERE campaign_id IS NOT NULL;

-- The fake ledger (LEDGER_MODE=fake) keeps the same rule.
ALTER TABLE platform.ledger_fake_hold
  ADD COLUMN campaign_id uuid,
  ADD COLUMN expires_at  timestamptz;
CREATE INDEX ledger_fake_hold_campaign_idx ON platform.ledger_fake_hold (campaign_id)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX ledger_fake_grant_campaign_idx ON platform.ledger_fake_grant (campaign_id, granted_at)
  WHERE campaign_id IS NOT NULL;
