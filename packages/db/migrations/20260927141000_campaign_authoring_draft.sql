-- TASKS.md 7.3: a draft campaign now exists before it has any of that.
--
-- Every column on campaign.campaigns was declared NOT NULL under the
-- assumption every row was a fully-published mock (YT-0519/YT-0101). The
-- authoring API breaks that assumption on purpose: a business creates a
-- DRAFT before a video is uploaded (7.2 attaches poster/teaser/hls/aspect/
-- bytes later, asynchronously, through the media pipeline's internal
-- endpoint) and before reward/budget exists (7.3.c is a separate step). A
-- fresh draft legitimately has neither, so the NOT NULL constraints that
-- modelled "already live" have to become "required once it LEAVES draft" —
-- moved from the column into a CHECK that reads lifecycle_state.
--
-- duration_seconds stays NOT NULL: a business declares an intended length at
-- draft creation, and 7.2's transcode reconciles the real one later. That is
-- a value that changes, not one that starts absent.
--
-- No backfill needed: every existing row (the seeded demo catalogue) is
-- already live/paused/ended with every one of these columns populated, so
-- relaxing NOT NULL cannot make an existing row invalid, and the new CHECKs
-- below hold for it unchanged.

ALTER TABLE campaign.campaigns
  ALTER COLUMN poster_url         DROP NOT NULL,
  ALTER COLUMN teaser_url         DROP NOT NULL,
  ALTER COLUMN hls_url            DROP NOT NULL,
  ALTER COLUMN aspect             DROP NOT NULL,
  ALTER COLUMN estimated_bytes    DROP NOT NULL,
  ALTER COLUMN estimated_data_mb  DROP NOT NULL,
  ALTER COLUMN reward_points      DROP NOT NULL,
  ALTER COLUMN question_count     DROP NOT NULL,
  ALTER COLUMN scoring_rule       DROP NOT NULL,
  ALTER COLUMN published_at       DROP NOT NULL;

-- The media pipeline's five columns, required from the moment a campaign is
-- no longer a draft. `draft` is the only state allowed to have any of these
-- NULL — `in_review` is the submit gate (7.3.d refuses submission without
-- them at the app layer; this is the same rule enforced as defense in depth,
-- the same relationship canTransition/the lifecycle trigger below have).
ALTER TABLE campaign.campaigns ADD CONSTRAINT campaigns_media_required_past_draft CHECK (
  lifecycle_state = 'draft' OR (
    poster_url        IS NOT NULL AND
    teaser_url         IS NOT NULL AND
    hls_url            IS NOT NULL AND
    aspect             IS NOT NULL AND
    estimated_bytes    IS NOT NULL AND
    estimated_data_mb  IS NOT NULL
  )
);

-- Same rule for the reward/terms mirror. campaign.reward_config is the
-- table of record (20260920000012_campaign_lifecycle.sql's own note on why
-- it carries no remaining balance applies here too, in spirit: these three
-- columns are the cheap-read mirror of the latest terms_version, not a
-- second source of truth), but the mirror must not be readable as "funded"
-- before 7.3.c has actually run.
ALTER TABLE campaign.campaigns ADD CONSTRAINT campaigns_reward_required_past_draft CHECK (
  lifecycle_state = 'draft' OR (
    reward_points  IS NOT NULL AND
    question_count IS NOT NULL AND
    scoring_rule   IS NOT NULL
  )
);

-- published_at is set exactly once, the moment lifecycle_state first becomes
-- `live`, and stays set through paused/ended (a paused or ended campaign was
-- live at some point and its wallet history still needs to name when). The
-- lifecycle trigger below stamps it; this CHECK is what makes "unset before
-- live, set from live onward" a fact the database enforces rather than a
-- convention the write path is trusted to keep.
ALTER TABLE campaign.campaigns ADD CONSTRAINT campaigns_published_at_iff_live_or_past CHECK (
  (published_at IS NOT NULL) = (lifecycle_state IN ('live', 'paused', 'ended'))
);

-- ---------------------------------------------------------------------------
-- declared_interests (7.7's feed ranking) and poster_frame_seconds (authoring)
-- ---------------------------------------------------------------------------
--
-- declared_interests: interest-taxonomy node ids this campaign targets,
-- matched against a viewer's OWN declared interests (me.interest) by 7.7's
-- ranking — never the reverse inference docs/20 §9 and red line 6 forbid.
-- Validated against packages/contracts/src/interest/taxonomy.ts's
-- isKnownInterestNode at the app layer: a taxonomy node set can grow, and a
-- CHECK pinned to today's node ids would need a migration every time it did.
-- The jsonb_typeof CHECK is the one invariant that IS cheap and permanent to
-- enforce here — this column is never a single string or object by mistake.
ALTER TABLE campaign.campaigns
  ADD COLUMN declared_interests jsonb NOT NULL DEFAULT '[]',
  ADD CONSTRAINT campaigns_declared_interests_is_array CHECK (
    jsonb_typeof(declared_interests) = 'array'
  );

-- poster_frame_seconds: which second of the source video the poster is
-- grabbed FROM — an authoring input the business (or teaser tooling) picks.
-- Distinct from poster_url, the RENDERED image the media pipeline produces
-- once that second is known. Nullable: a draft with no video yet has no
-- frame to name. Bounded by duration_seconds, which is NOT NULL from draft
-- creation onward, so the comparison is always well-defined.
ALTER TABLE campaign.campaigns
  ADD COLUMN poster_frame_seconds integer,
  ADD CONSTRAINT campaigns_poster_frame_within_duration CHECK (
    poster_frame_seconds IS NULL OR (
      poster_frame_seconds >= 0 AND poster_frame_seconds <= duration_seconds
    )
  );

-- ---------------------------------------------------------------------------
-- EW-17: the lifecycle transition table, enforced again at the database
-- ---------------------------------------------------------------------------
--
-- The SAME table campaign-lifecycle.ts's CAMPAIGN_LIFECYCLE_TRANSITIONS
-- exports and campaign-lifecycle.test.ts checks every pair of, so a bug or a
-- bypassed canTransition() call in application code cannot walk a campaign
-- through an illegal move — the same defense-in-depth relationship
-- ledger.assert_transfer_balanced() has to the ledger's own TypeScript
-- checks (20260925181000_ledger_guards.sql).
--
-- `BEFORE UPDATE OF lifecycle_state` so the trigger does not fire at all on
-- an UPDATE that never names the column. The unchanged-value case (an
-- UPDATE that names lifecycle_state but sets it to what it already was) is
-- handled inside the function as a no-op, per spec, rather than a refusal —
-- an application-level "save" that happens to re-send the current state is
-- not an illegal transition, it is not a transition at all.
CREATE FUNCTION campaign.assert_lifecycle_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.lifecycle_state = OLD.lifecycle_state THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.lifecycle_state = 'draft'     AND NEW.lifecycle_state = 'in_review') OR
    (OLD.lifecycle_state = 'in_review' AND NEW.lifecycle_state IN ('live', 'rejected', 'draft')) OR
    (OLD.lifecycle_state = 'rejected'  AND NEW.lifecycle_state = 'draft') OR
    (OLD.lifecycle_state = 'live'      AND NEW.lifecycle_state IN ('paused', 'ended')) OR
    (OLD.lifecycle_state = 'paused'    AND NEW.lifecycle_state IN ('live', 'ended'))
    -- 'ended' has no branch at all: it is terminal, so every transition out
    -- of it falls through to the exception below.
  ) THEN
    RAISE EXCEPTION 'campaign: % -> % is not a legal lifecycle transition', OLD.lifecycle_state, NEW.lifecycle_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- The one write this trigger makes rather than merely checks: the moment
  -- a campaign first reaches `live`, published_at is the database's clock,
  -- never the caller's (the same call EM-18/ledger.stamp_now() makes for
  -- created_at). Guarded by IS NULL so a later paused -> live resume, which
  -- is also a transition INTO 'live', never overwrites the original.
  IF NEW.lifecycle_state = 'live' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaigns_lifecycle_transition
  BEFORE UPDATE OF lifecycle_state ON campaign.campaigns
  FOR EACH ROW EXECUTE FUNCTION campaign.assert_lifecycle_transition();
