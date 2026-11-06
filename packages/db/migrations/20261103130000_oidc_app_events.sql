-- Group 3.7 Y1 (docs/29 §5): the two functions that tell apps a person is gone
-- or their access ended, by writing oidc.event_outbox rows in the caller's
-- transaction. The worker signs and sends them (Y4).
--
-- Plain SECURITY INVOKER functions: yourtal_app already holds every grant they
-- use (20261021025420_oidc_provider.sql), so they add no privilege, and the
-- region wall on teen_invite and consent_record still applies. The search_path
-- is pinned all the same.

-- Y4's order rule: the earliest undelivered event for one client and sub.
CREATE INDEX event_outbox_pending_idx ON oidc.event_outbox (client_id, sub, iat)
  WHERE delivered_at IS NULL;

-- Ends one person's access to one app (sector) for one of docs/26 §2.2's six
-- reasons: ends the live consent, appends the `withdrawn` evidence, ends their
-- live teen invite there, and queues `access-ended` for `receiver` (NULL when the
-- sector has no receiver: the access still ends, nothing is sent). `invite`
-- narrows it to the consent and invite of one teen invite. The four teen
-- reasons (erase_data true) touch only a consent given through an invite by
-- someone still under 18 (UTC, as ageYearsFrom): an adult's space is their own
-- (docs/26 §3.3).
-- False, with nothing written, when no such consent is live.
CREATE FUNCTION oidc.end_app_access(
  person text, app_sector text, receiver text, reason text, invite uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, oidc, identity
AS $$
DECLARE
  teen_only boolean := reason IN ('guardian_withdrew', 'parent_ended', 'teen_removed', 'inviter_deleted');
  policy text;
  recorded integer;
  sub_of text;
BEGIN
  IF person IS NULL OR length(person) = 0 OR app_sector IS NULL OR length(app_sector) = 0 THEN
    RAISE EXCEPTION 'oidc: a person and a sector are required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF reason IS NULL OR reason NOT IN
      ('user_removed', 'security', 'guardian_withdrew', 'parent_ended', 'teen_removed', 'inviter_deleted') THEN
    RAISE EXCEPTION 'oidc: unknown access-ended reason %', reason USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Invite before consent, the order 3.9.e's invite end takes, so the two cannot deadlock.
  PERFORM 1 FROM oidc.teen_invite
   WHERE teen_user_id = person AND sector = app_sector
     AND accepted_at IS NOT NULL AND ended_at IS NULL
     AND (invite IS NULL OR id = invite)
     FOR UPDATE;

  UPDATE oidc.app_consent c
     SET ended_at = now(), end_reason = reason
   WHERE c.user_id = person AND c.sector = app_sector AND c.ended_at IS NULL
     AND (invite IS NULL OR c.invite_id = invite)
     AND (NOT teen_only OR (c.granted_via = 'guardian_invite' AND EXISTS (
           SELECT 1 FROM identity.user_profile p
            WHERE p.user_id = c.user_id
              AND extract(year FROM age((now() AT TIME ZONE 'UTC')::date, p.date_of_birth)) < 18)))
  RETURNING c.policy_version_id INTO policy;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Append-only evidence; the reason is the source (consent-record.ts lists them).
  INSERT INTO identity.consent_record
    (user_id, purpose, jurisdiction, policy_version_id, state, recorded_at, source, audience)
  SELECT person, 'sister_app_profile_sharing', p.region, policy, 'withdrawn', now(), reason, app_sector
    FROM identity.user_profile p WHERE p.user_id = person;
  GET DIAGNOSTICS recorded = ROW_COUNT;
  IF recorded = 0 THEN
    RAISE EXCEPTION 'oidc: no profile for %, so no withdrawal can be recorded', person
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE oidc.teen_invite
     SET ended_at = now(), end_reason = reason
   WHERE teen_user_id = person AND sector = app_sector
     AND accepted_at IS NOT NULL AND ended_at IS NULL
     AND (invite IS NULL OR id = invite);

  SELECT s.sub INTO sub_of FROM oidc.subject s WHERE s.sector = app_sector AND s.user_id = person;
  IF receiver IS NOT NULL AND sub_of IS NOT NULL THEN
    INSERT INTO oidc.event_outbox (jti, client_id, sub, event_type, payload, iat)
    VALUES (gen_random_uuid(), receiver, sub_of, 'urn:yourtal:event:access-ended',
            jsonb_build_object('urn:yourtal:event:access-ended',
              jsonb_build_object('reason', reason, 'erase_data', teen_only)),
            now());
  END IF;
  RETURN true;
END;
$$;

-- The connected_apps erasure for one person. `receivers` is the registry
-- (event-receivers.ts): a JSON array of {"sector", "clientId", ...}, at most one
-- per sector. Ends the access of every teen the person invited
-- (`inviter_deleted`), queues one `account-deleted` per sector where the person
-- has a sub and a receiver, then deletes their subject, app_consent,
-- teen_invite (as inviter or teen), sign_in_log and provider rows. Consent
-- records stay: they are the evidence. Returns rows written plus rows deleted;
-- a second call finds nothing and returns 0.
CREATE FUNCTION oidc.forget_subject(person text, receivers jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, oidc
AS $$
DECLARE
  total integer := 0;
  n integer;
  teen record;
BEGIN
  IF person IS NULL OR length(person) = 0 THEN
    RAISE EXCEPTION 'oidc: a person is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- An empty list would drop every app link with no app told, for good.
  IF jsonb_typeof(receivers) IS DISTINCT FROM 'array' OR jsonb_array_length(receivers) = 0 THEN
    RAISE EXCEPTION 'oidc: receivers must be a non-empty JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT r->>'sector') OR bool_or(r->>'sector' IS NULL OR r->>'clientId' IS NULL)
        FROM jsonb_array_elements(receivers) r) THEN
    RAISE EXCEPTION 'oidc: each receiver needs a sector and a clientId, one per sector'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The API's deletion and the worker's sweep may race: the second waits here,
  -- then finds no subject rows, so no event is queued twice. (FOR UPDATE would
  -- need UPDATE on oidc.subject, which the app must not hold.) Assumes READ
  -- COMMITTED: each later statement takes a snapshot after the lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('oidc.forget_subject:' || person, 0));

  FOR teen IN
    SELECT i.id, i.sector, i.teen_user_id, r->>'clientId' AS client_id
      FROM oidc.teen_invite i
      LEFT JOIN jsonb_array_elements(receivers) r ON r->>'sector' = i.sector
     WHERE i.inviter_user_id = person AND i.accepted_at IS NOT NULL AND i.ended_at IS NULL
  LOOP
    IF oidc.end_app_access(teen.teen_user_id, teen.sector, teen.client_id, 'inviter_deleted', teen.id) THEN
      total := total + 1;
    END IF;
  END LOOP;

  INSERT INTO oidc.event_outbox (jti, client_id, sub, event_type, payload, iat)
  SELECT gen_random_uuid(), r->>'clientId', s.sub, 'urn:yourtal:event:account-deleted',
         jsonb_build_object('urn:yourtal:event:account-deleted', '{}'::jsonb), now()
    FROM oidc.subject s
    JOIN jsonb_array_elements(receivers) r ON r->>'sector' = s.sector
   WHERE s.user_id = person;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  DELETE FROM oidc.subject WHERE user_id = person;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM oidc.app_consent WHERE user_id = person;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM oidc.teen_invite WHERE inviter_user_id = person OR teen_user_id = person;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM oidc.sign_in_log WHERE user_id = person;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  -- accountId sits at the top of sessions, grants and tokens, and nested in interactions.
  DELETE FROM oidc.model
   WHERE jsonb_path_exists(payload, 'strict $.**.accountId ? (@ == $p)', jsonb_build_object('p', person));
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION oidc.end_app_access(text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION oidc.end_app_access(text, text, text, text, uuid) TO yourtal_app;
REVOKE ALL ON FUNCTION oidc.forget_subject(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION oidc.forget_subject(text, jsonb) TO yourtal_app;
