-- 5.1.b, EW-01/EW-10: parking, non-earning sessions, and the per-session
-- question counters completion reads instead of re-selecting
-- `campaign.question_response` (which `yourtal_app` deliberately cannot
-- SELECT — 20260921233000's own comment says why).

-- `parked`: a session set aside while the user watches something else,
-- resumable while its campaign is live and its terms version unchanged
-- (watch-session.ts's own comment has the full reasoning). Add-only: widen
-- the CHECK rather than edit the existing migration.
ALTER TABLE watch.session DROP CONSTRAINT session_state_check;
ALTER TABLE watch.session ADD CONSTRAINT session_state_check
  CHECK (state IN ('active', 'completed', 'superseded', 'void', 'parked'));

ALTER TABLE watch.session
  ADD COLUMN non_earning        boolean NOT NULL DEFAULT false,
  ADD COLUMN non_earning_reason text,
  ADD COLUMN hold_id            text,
  -- Derived from `campaign.question_response` AT WRITE TIME (in the same
  -- transaction as each answer), never by re-reading that table back —
  -- `yourtal_app` has INSERT only on it, by design. These are the counters
  -- completion actually reads.
  ADD COLUMN questions_asked   integer NOT NULL DEFAULT 0 CHECK (questions_asked >= 0),
  ADD COLUMN questions_correct integer NOT NULL DEFAULT 0 CHECK (questions_correct >= 0 AND questions_correct <= questions_asked);

ALTER TABLE watch.session ADD CONSTRAINT non_earning_reason_iff_non_earning CHECK (
  non_earning OR non_earning_reason IS NULL
);

-- At most one OPEN (active or parked) session per (user, campaign, terms
-- version). This is what makes coverage effectively keyed to that tuple
-- without moving `watch.coverage`'s own foreign key: `start()` looks for a
-- row matching this tuple before ever creating a new one, and this index is
-- what makes two concurrent starts racing that lookup resolve to one row
-- rather than two, the same reasoning `session_one_active_per_user` already
-- follows for "active" alone.
CREATE UNIQUE INDEX session_one_open_per_user_campaign_terms
  ON watch.session (user_id, campaign_id, terms_version)
  WHERE state IN ('active', 'parked');
