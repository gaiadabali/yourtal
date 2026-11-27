-- god/TASKS.md 9.1.b/9.1.c: consent to the GOD Group Privacy Notice. Nobody's
-- data enters GOD (the group YourTal, SnapApp and Free Tax Returns belong to)
-- until they, or a teen's guardian, accept it. Add-only: two new tables, one
-- trigger function and one erase function; nothing existing is touched.
--
-- `god_group_consent` is the evidence: append-only, one row per decision
-- (accepted, declined or withdrawn) against one notice version, shaped like
-- the contract the three apps share (@yourtal/consent/god-group-notice). The
-- app role may INSERT and SELECT only, the same grant identity.consent_record
-- has, so a decision can never be edited after the fact.
--
-- `god_group_consent_status` is the current decision per person, kept by a
-- trigger, so "who is in GOD" is one indexed read and a later task (9.5) can
-- replicate it without replaying the log. The app may only read it.
--
-- `track` marks the sealed teen track (9.7.d): every decision about a 13-17
-- account is `teen`, and a teen's acceptance can only come from their
-- guardian. GOD routes on this column and never needs a date of birth.

CREATE TABLE identity.god_group_consent (
  id                bigserial   PRIMARY KEY,
  user_id           text        NOT NULL CHECK (char_length(user_id) > 0),
  region            text        NOT NULL CHECK (region IN ('AU', 'ID')),
  notice_id         text        NOT NULL CHECK (char_length(notice_id) > 0),
  notice_version    text        NOT NULL CHECK (char_length(notice_version) > 0),
  decision          text        NOT NULL CHECK (decision IN ('accepted', 'declined', 'withdrawn')),
  -- `request` is a withdrawal asked for through the request form (founder, Q4).
  method            text        NOT NULL CHECK (method IN ('registration', 'next_sign_in', 'guardian', 'request')),
  track             text        NOT NULL CHECK (track IN ('adult', 'teen')),
  -- Set only when the guardian has an account of their own; a YourTal guardian
  -- decides through their emailed link and has none.
  guardian_user_id  text        CHECK (guardian_user_id IS NULL OR char_length(guardian_user_id) > 0),
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT god_group_consent_guardian_id_only_from_guardian
    CHECK (guardian_user_id IS NULL OR method = 'guardian'),
  -- Registration's tick box only ever accepts; a request only ever withdraws.
  CONSTRAINT god_group_consent_registration_accepts
    CHECK (method <> 'registration' OR decision = 'accepted'),
  CONSTRAINT god_group_consent_request_withdraws
    CHECK (method <> 'request' OR decision = 'withdrawn'),
  -- A teen never accepts for themselves.
  CONSTRAINT god_group_consent_teen_accepts_through_guardian
    CHECK (track = 'adult' OR decision <> 'accepted' OR method = 'guardian')
);

CREATE INDEX god_group_consent_user_idx
  ON identity.god_group_consent (user_id, recorded_at DESC, id DESC);

CREATE TABLE identity.god_group_consent_status (
  user_id           text        PRIMARY KEY,
  region            text        NOT NULL CHECK (region IN ('AU', 'ID')),
  notice_id         text        NOT NULL,
  notice_version    text        NOT NULL,
  decision          text        NOT NULL CHECK (decision IN ('accepted', 'declined', 'withdrawn')),
  method            text        NOT NULL,
  track             text        NOT NULL CHECK (track IN ('adult', 'teen')),
  guardian_user_id  text,
  decided_at        timestamptz NOT NULL,
  -- The god_group_consent row this mirrors.
  consent_id        bigint      NOT NULL
);

-- Owned by the migrator, so the app needs no write grant on the status table.
-- Ties on recorded_at (two decisions in one transaction) go to the later row.
CREATE FUNCTION identity.god_group_consent_keep_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $$
BEGIN
  INSERT INTO identity.god_group_consent_status AS s
    (user_id, region, notice_id, notice_version, decision, method, track,
     guardian_user_id, decided_at, consent_id)
  VALUES
    (NEW.user_id, NEW.region, NEW.notice_id, NEW.notice_version, NEW.decision, NEW.method,
     NEW.track, NEW.guardian_user_id, NEW.recorded_at, NEW.id)
  ON CONFLICT (user_id) DO UPDATE
    SET region = EXCLUDED.region,
        notice_id = EXCLUDED.notice_id,
        notice_version = EXCLUDED.notice_version,
        decision = EXCLUDED.decision,
        method = EXCLUDED.method,
        track = EXCLUDED.track,
        guardian_user_id = EXCLUDED.guardian_user_id,
        decided_at = EXCLUDED.decided_at,
        consent_id = EXCLUDED.consent_id
    WHERE (s.decided_at, s.consent_id) <= (EXCLUDED.decided_at, EXCLUDED.consent_id);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION identity.god_group_consent_keep_status() FROM PUBLIC;

CREATE TRIGGER god_group_consent_keep_status
  AFTER INSERT ON identity.god_group_consent
  FOR EACH ROW EXECUTE FUNCTION identity.god_group_consent_keep_status();

-- Account deletion (the identity DSAR domain): the person leaves GOD's view by
-- losing their status row. The decisions themselves stay, as evidence of the
-- basis relied on, the same retain rule identity.consent_record follows.
CREATE FUNCTION identity.forget_god_group_status(subject text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $$
DECLARE
  n integer;
BEGIN
  IF subject IS NULL OR length(subject) = 0 THEN
    RAISE EXCEPTION 'god consent: a subject is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM identity.god_group_consent_status WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION identity.forget_god_group_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.forget_god_group_status(text) TO yourtal_app;

-- The region wall (13.5.e), as on every other table with a region column.
ALTER TABLE identity.god_group_consent ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON identity.god_group_consent
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE identity.god_group_consent_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON identity.god_group_consent_status
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

GRANT SELECT, INSERT ON identity.god_group_consent TO yourtal_app;
GRANT USAGE, SELECT ON SEQUENCE identity.god_group_consent_id_seq TO yourtal_app;
GRANT SELECT ON identity.god_group_consent_status TO yourtal_app;
