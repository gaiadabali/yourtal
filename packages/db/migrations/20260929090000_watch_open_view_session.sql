-- TASKS.md 11.2.b: Open Viewing's anonymous, non-earning watch session.
-- Deliberately its own table, never `watch.session` (which is reward-
-- bearing, keyed to a real user, and feeds the ledger hold/grant path) --
-- an anonymous view must be structurally incapable of ever being confused
-- with one that can earn.
--
-- `ip_hash`, never the raw IP: this table exists only to enforce the F12
-- per-IP cap (60 min/day, one concurrent session), never to identify a
-- visitor, so there is nothing here worth storing in the clear.
CREATE TABLE watch.open_view_session (
  id               uuid        PRIMARY KEY,
  campaign_id      uuid        NOT NULL REFERENCES campaign.campaigns (id),
  region           text        NOT NULL,
  ip_hash          text        NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  -- Server clock at the last accepted progress report -- same convention as
  -- `watch.session.last_progress_at` -- and what "one concurrent session"
  -- reads to decide whether a prior row is still live or has gone idle.
  last_progress_at timestamptz NOT NULL DEFAULT now(),
  watched_seconds  integer     NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0)
);

-- The F12 daily cap is a rolling 24h sum per IP, not a calendar-day bucket
-- (no midnight reset to game). This index is that query's access path.
CREATE INDEX open_view_session_ip_started_idx ON watch.open_view_session (ip_hash, started_at);

-- "One concurrent anonymous session per IP" reads the most recent row for
-- this ip_hash and checks whether it is still within the idle window.
CREATE INDEX open_view_session_ip_progress_idx ON watch.open_view_session (ip_hash, last_progress_at DESC);

CREATE INDEX open_view_session_campaign_idx ON watch.open_view_session (campaign_id);

-- No DELETE: these rows are the evidence 11.2.d's report counts, same as
-- `watch.coverage`'s own append-mostly grant.
GRANT SELECT, INSERT, UPDATE ON watch.open_view_session TO yourtal_app;
