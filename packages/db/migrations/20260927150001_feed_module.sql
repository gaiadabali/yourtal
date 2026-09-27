-- 7.7: the feed module's own tables. A new `feed` schema (one per module,
-- docs/13b section 7), not campaign.* -- 7.3 owns that schema's tables and
-- is being built concurrently in a sibling worktree.

CREATE SCHEMA IF NOT EXISTS feed;

-- 7.7.b: advisory per-campaign pacing. The hard stop is the ledger's
-- allocation hold (funded = remaining after holds); this only smooths
-- delivery within that budget. `served_today`/`day` reset naturally: a new
-- day's first serve upserts `day` and starts the count over (see
-- drizzle-pacing-state.repository.ts), so there is no cron job to forget.
CREATE TABLE feed.pacing_state (
  campaign_id   uuid        PRIMARY KEY,
  day           date        NOT NULL,
  served_today  integer     NOT NULL DEFAULT 0 CHECK (served_today >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- "Not interested" (7.7.a): demotes a campaign for this viewer on their next
-- fetch. A demotion, not a block -- the item can still appear, ranked lower
-- -- so this is a plain per-user marker, not a hide-list with its own
-- lifecycle.
CREATE TABLE feed.demotion (
  user_id       text        NOT NULL,
  campaign_id   uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, campaign_id)
);

GRANT SELECT, INSERT, UPDATE ON feed.pacing_state TO yourtal_app;
GRANT SELECT, INSERT         ON feed.demotion      TO yourtal_app;
