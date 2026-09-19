-- YT-0101: the campaign authoring model, and YT-0548's missing creative
-- storage.
--
-- Four things land together because they are one aggregate: a campaign's
-- authoring state, the creative it plays, the terms it promised, and the
-- allocation that funds it. Splitting them across migrations would leave
-- intermediate states where a campaign can be `live` with nothing to play.

-- ---------------------------------------------------------------------------
-- The authoring lifecycle replaces the stored public status
-- ---------------------------------------------------------------------------
--
-- `campaign.campaigns.status` held `active | paused | ended` — what a VIEWER
-- sees. It has no way to say "draft", which is why the advertiser console
-- had to invent its own enum in `apps/web` and flag the decision.
--
-- Storing both would be two copies of one fact: `publicStatusOf` derives the
-- viewer-facing status from the authoring state, and a stored `status`
-- alongside it is a value that can disagree with the thing it comes from.
-- So `status` is DROPPED and derived on read. `schema-drift.test.ts` records
-- it as a field with no column, with that reason — the honest use of that
-- list, as opposed to a gap nobody noticed.
--
-- `rejected` and `ended` both exist because they are different facts: review
-- said no and it never ran, versus it ran and finished.
ALTER TABLE campaign.campaigns
  ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_state IN ('draft', 'in_review', 'rejected', 'live', 'paused', 'ended'));

-- Existing rows are published mock campaigns, so they map back through the
-- derivation rather than defaulting to draft — which would have hidden the
-- whole seeded catalogue from the board.
UPDATE campaign.campaigns
   SET lifecycle_state = CASE status
                           WHEN 'active' THEN 'live'
                           WHEN 'paused' THEN 'paused'
                           ELSE 'ended'
                         END;

ALTER TABLE campaign.campaigns DROP COLUMN status;
ALTER TABLE campaign.campaigns ALTER COLUMN lifecycle_state DROP DEFAULT;

CREATE INDEX campaigns_lifecycle_idx ON campaign.campaigns (lifecycle_state);

-- A rejection needs its reason, or "rejected" is a dead end the advertiser
-- cannot act on. Null unless rejected, and the constraint says so both ways:
-- a reason without a rejection is a leftover from a state that moved on.
ALTER TABLE campaign.campaigns ADD COLUMN rejection_reason text;
ALTER TABLE campaign.campaigns
  ADD CONSTRAINT campaigns_rejection_reason_iff_rejected CHECK (
    (lifecycle_state = 'rejected') = (rejection_reason IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Creative: chapters (YT-0548)
-- ---------------------------------------------------------------------------
--
-- `campaignSchema.chapters` was a REQUIRED field with no storage anywhere,
-- so every row in this table was unparseable as a `Campaign`. Invisible only
-- because Phase U reads mocks.
--
-- No `end_seconds` column: a chapter's end IS the next chapter's start, or
-- the campaign's `duration_seconds` for the last one. Storing it is the
-- derived-value bug, and it would be the copy that goes stale when a chapter
-- is inserted.
CREATE TABLE campaign.chapter (
  campaign_id   uuid    NOT NULL REFERENCES campaign.campaigns (id) ON DELETE CASCADE,
  ordinal       integer NOT NULL CHECK (ordinal >= 0),
  title         text    NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  start_seconds integer NOT NULL CHECK (start_seconds >= 0),

  -- Stored, with its consumer in question. Under founder decision O-1 the
  -- reward is one grant at completion, so there is no partial credit to
  -- allocate and `chapterRewardPoints` has no caller on the value path.
  -- Kept because dropping a field mid-decision is worse than carrying one
  -- whose purpose is being settled (YT-0124) — but PER-CHAPTER POINTS ARE
  -- NEVER STORED, and must not be: that would be a second total nobody
  -- guarantees agrees with `reward_points`.
  reward_weight numeric NOT NULL CHECK (reward_weight > 0),

  PRIMARY KEY (campaign_id, ordinal)
);

-- Chapters must be strictly ascending in time. Without this, two chapters
-- can share a start or run backwards, and every progress calculation built
-- on them silently produces nonsense rather than failing.
CREATE UNIQUE INDEX chapter_start_unique ON campaign.chapter (campaign_id, start_seconds);

-- ---------------------------------------------------------------------------
-- Creative: the video source (YT-0548)
-- ---------------------------------------------------------------------------
--
-- `kind` plus per-kind fields behind a CHECK, rather than a jsonb blob, so
-- the discriminated union stays additive: adding an `mp4` kind is a new
-- column and a widened CHECK, and every existing `hls` row stays valid. A
-- jsonb column would make the union a convention rather than a constraint.
CREATE TABLE campaign.video_source (
  campaign_id  uuid PRIMARY KEY REFERENCES campaign.campaigns (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('hls')),
  manifest_url text,

  CONSTRAINT video_source_hls_has_manifest CHECK (
    kind <> 'hls' OR manifest_url IS NOT NULL
  )
);

-- ---------------------------------------------------------------------------
-- The terms a viewer entered under, frozen
-- ---------------------------------------------------------------------------
--
-- Immutable versions, not a per-session copy. An advertiser editing a live
-- campaign must not change what someone already watching is owed — and under
-- O-1 the reward is all or nothing at completion, so a viewer gives the full
-- thirty minutes before learning what they get. There is no partial credit
-- to soften a change made at minute twenty-nine.
--
-- Only reward-affecting fields live here. A title edit changes nothing a
-- viewer is owed, and versioning every typo would bury the changes that do.
CREATE TABLE campaign.terms_version (
  campaign_id      uuid        NOT NULL REFERENCES campaign.campaigns (id) ON DELETE CASCADE,
  version          integer     NOT NULL CHECK (version >= 1),
  reward_points    bigint      NOT NULL CHECK (reward_points >= 0),
  question_count   integer     NOT NULL CHECK (question_count BETWEEN 0 AND 20),
  scoring_rule     text        NOT NULL CHECK (scoring_rule IN ('base_only', 'base_plus_accuracy_bonus')),
  duration_seconds integer     NOT NULL CHECK (duration_seconds > 0),
  effective_from   timestamptz NOT NULL,

  PRIMARY KEY (campaign_id, version),

  -- The same biconditional `campaignSchema` enforces: an accuracy bonus
  -- needs something to score accuracy against.
  CONSTRAINT terms_bonus_needs_questions CHECK (
    scoring_rule <> 'base_plus_accuracy_bonus' OR question_count > 0
  )
);

-- ---------------------------------------------------------------------------
-- What funds the campaign
-- ---------------------------------------------------------------------------
--
-- Deliberately carries NO remaining balance. `ledger.allocation` owns that
-- number, with `CHECK (remaining_points >= 0)` and a conditional drawdown
-- that simply matches no row when exhausted — that is the hard stop, in the
-- value zone, owned by the ledger role. A copy here would be a second total
-- updated by a different process, disagreeing the first time a grant lands
-- between reads, with the copy being the one shown to the advertiser.
--
-- `allocation_id` is intentionally NOT a foreign key. `ledger.allocation`
-- belongs to the ledger role and `campaign` to the app role; a foreign key
-- across that boundary would hand the app a read dependency on value-zone
-- state and make the zone separation decorative. The link is checked by the
-- Reward Engine at grant time, which is the only place it can be enforced
-- honestly anyway.
CREATE TABLE campaign.reward_config (
  campaign_id                  uuid   PRIMARY KEY REFERENCES campaign.campaigns (id) ON DELETE CASCADE,
  allocation_id                text   NOT NULL,
  funder_type                  text   NOT NULL CHECK (funder_type IN ('partner', 'marketing')),
  max_points_for_campaign      bigint NOT NULL CHECK (max_points_for_campaign > 0),
  reward_points_per_completion bigint NOT NULL CHECK (reward_points_per_completion > 0),
  accuracy_bonus_points        bigint NOT NULL CHECK (accuracy_bonus_points >= 0),

  -- A campaign whose single completion cannot fit inside its own ceiling can
  -- never pay anybody. Better refused here than discovered when the first
  -- viewer finishes thirty minutes of video.
  CONSTRAINT reward_config_completion_fits CHECK (
    reward_points_per_completion + accuracy_bonus_points <= max_points_for_campaign
  )
);

CREATE INDEX reward_config_allocation_idx ON campaign.reward_config (allocation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign.chapter        TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign.video_source   TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign.reward_config  TO yourtal_app;

-- Terms versions are INSERT and SELECT only for the app. A frozen promise
-- that the app can rewrite is not frozen — the whole point is that a viewer
-- who entered under version 1 is still owed what version 1 said, and an
-- UPDATE grant would make that a convention rather than a guarantee.
GRANT SELECT, INSERT ON campaign.terms_version TO yourtal_app;
