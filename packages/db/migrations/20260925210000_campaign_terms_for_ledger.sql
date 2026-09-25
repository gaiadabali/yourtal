-- 4.4.a-d: a campaign reward is paid what the partner set, once.
--
-- The ledger reads a campaign's owner, region and state, and its frozen
-- terms versions, through two narrow views; it never reads the editable
-- campaign tables themselves.

CREATE VIEW campaign.campaign_owner AS
  SELECT id, business_id, region, lifecycle_state AS state
  FROM campaign.campaigns;

CREATE VIEW campaign.campaign_terms AS
  SELECT campaign_id, version, reward_points, question_count, scoring_rule,
         COALESCE(accuracy_bonus_points, 0)::bigint AS accuracy_bonus_points
  FROM campaign.terms_version;

GRANT SELECT ON campaign.campaign_owner, campaign.campaign_terms TO yourtal_ledger;

-- 4.4.d: one reward per user per campaign, whatever key the caller sends.
CREATE UNIQUE INDEX grant_one_reward_per_campaign
  ON ledger.grant (user_id, campaign_id)
  WHERE action_type = 'watch_completed' AND campaign_id IS NOT NULL;

-- 4.4.c: the completion attestation each campaign grant was paid on.
ALTER TABLE ledger.grant
  ADD COLUMN session_id    text,
  ADD COLUMN terms_version integer,
  ADD COLUMN asked         integer CHECK (asked IS NULL OR asked >= 0),
  ADD COLUMN correct       integer CHECK (correct IS NULL OR (correct >= 0 AND correct <= asked));
