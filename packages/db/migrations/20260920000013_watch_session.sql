-- YT-0120: the watch session service's state.
--
-- Two tables: what a viewer is attempting, and what they have actually
-- watched. The second is the one that decides a reward.

-- ---------------------------------------------------------------------------
-- The session
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS watch;

CREATE TABLE watch.session (
  id               uuid        PRIMARY KEY,
  user_id          uuid        NOT NULL,
  campaign_id      uuid        NOT NULL REFERENCES campaign.campaigns (id),

  -- The terms this viewer entered under (YT-0101). A COMPOSITE foreign key,
  -- so a session cannot reference a version of a different campaign — the
  -- same reason `voucher.vouchers` keys its location through
  -- `store.listing_location` rather than trusting two independent ids to
  -- agree. Without it, "the terms you agreed to" is a number nothing checks.
  terms_version    integer     NOT NULL,

  state            text        NOT NULL CHECK (state IN ('active', 'completed', 'superseded', 'void')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  -- Server clock at the last ACCEPTED progress report. The rate check reads
  -- this, never the client's own timestamp.
  last_progress_at timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,

  FOREIGN KEY (campaign_id, terms_version)
    REFERENCES campaign.terms_version (campaign_id, version),

  -- `completed_at` is set if and only if the session completed. A completion
  -- time on an active session, or a completed session with no time, is a
  -- state nobody can interpret afterwards.
  CONSTRAINT session_completed_at_iff_completed CHECK (
    (state = 'completed') = (completed_at IS NOT NULL)
  )
);

-- ONE reward-bearing session per user, enforced here rather than in a
-- service. Two concurrent "start watching" requests both reading "no active
-- session" and both inserting is the ordinary race, and a check in
-- application code cannot settle it — only a unique index can.
--
-- Partial, on `active` only: a user accumulates any number of superseded and
-- completed sessions over time, and those are history rather than contention.
CREATE UNIQUE INDEX session_one_active_per_user ON watch.session (user_id) WHERE state = 'active';

CREATE INDEX session_campaign_idx ON watch.session (campaign_id);
CREATE INDEX session_user_idx ON watch.session (user_id);

-- ---------------------------------------------------------------------------
-- What was actually watched
-- ---------------------------------------------------------------------------
--
-- Append-only reports, not a running total. Coverage is DERIVED by merging
-- these spans, for the same reason the ledger derives a balance from entries
-- rather than storing one: a stored total is a second copy that a concurrent
-- write can corrupt, and there is no way afterwards to tell whether it is
-- right.
--
-- It also keeps the raw evidence. A fraud review needs to see the shape of
-- what somebody claimed — forty identical two-second spans at 3am looks
-- nothing like a person watching — and a total answers no question at all.
--
-- Whole seconds, half-open `[from_second, to_second)`. Floating-point
-- positions never sum to exactly the duration, so a rule stated over floats
-- is one no honest viewer can satisfy.
CREATE TABLE watch.coverage (
  id           bigserial   PRIMARY KEY,
  session_id   uuid        NOT NULL REFERENCES watch.session (id) ON DELETE CASCADE,
  from_second  integer     NOT NULL CHECK (from_second >= 0),
  to_second    integer     NOT NULL,
  -- Server clock. The client's own timestamp is recorded on the request log,
  -- not here, because this column is what the rate check reasons about.
  recorded_at  timestamptz NOT NULL DEFAULT now(),

  -- A span that does not move forwards covers nothing. Refusing it here as
  -- well as in the service means a direct write cannot create a row that
  -- every reader would have to defend against.
  CONSTRAINT coverage_moves_forward CHECK (to_second > from_second)
);

CREATE INDEX coverage_session_idx ON watch.coverage (session_id, from_second);

-- No UPDATE and no DELETE for the app. Coverage is the evidence a reward is
-- paid against, and evidence that can be edited after the fact is not
-- evidence — the same grant shape as `ledger.entry`. A session's rows go
-- only when the session itself is deleted, which the cascade handles.
GRANT SELECT, INSERT, UPDATE ON watch.session  TO yourtal_app;
GRANT SELECT, INSERT          ON watch.coverage TO yourtal_app;
GRANT USAGE                   ON SCHEMA watch   TO yourtal_app;
GRANT USAGE, SELECT           ON SEQUENCE watch.coverage_id_seq TO yourtal_app;
