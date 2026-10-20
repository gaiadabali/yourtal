-- Group 1.20: account deletion must reach every personal table. Three
-- functions give the `me_data`, `org_memberships` and `watch_sessions` DSAR
-- domains something to call. Nothing here adds a table, a column or a grant.
--
-- The app role has no DELETE on most of these tables (streak, notifications,
-- settings, link of a charity member, a watch session and its coverage...),
-- and it must not get one: DELETE on a notification or a watch session is
-- also "rewrite what the user did". Each function below is SECURITY DEFINER,
-- owned by the tables' owner (the migrator, as for
-- platform.forget_partner_subject and platform.pseudonymise_ledger_subject),
-- with the search_path pinned, EXECUTE revoked from PUBLIC and granted only to
-- yourtal_app. Each can only delete rows keyed by the one subject passed in, so
-- the app gains the ability to erase a named subject and nothing it could not
-- already do through the same call for `partner_link`.
--
-- All three are idempotent: a second call finds nothing and returns 0.
--
-- Left out on purpose:
--   * me.link_code is deleted by platform.forget_partner_subject (partner_links).
--   * me.viewer_area (branch group/1.6fgh-areas) is deleted by eraseIdentity.
--   * platform.delivery_log is append-only evidence for delivery-gap checks
--     (REVOKE UPDATE, DELETE) and holds a session id, no user id. Once the
--     session row is gone it names no one.

-- ---------------------------------------------------------------------------
-- me_data: everything the viewer declared, saved or was told, in `me`, plus the
-- feed's "show me less of this" marker. One statement per table, one
-- transaction, so a failure leaves nothing half erased.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.erase_me_subject(subject text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, me, feed
AS $$
DECLARE
  total integer := 0;
  n integer;
BEGIN
  IF subject IS NULL OR length(subject) = 0 THEN
    RAISE EXCEPTION 'me: a subject is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  DELETE FROM me.interest WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM me.follow WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM me.save WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM me.streak_state WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM me.notification WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM me.notification_preference WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM me.viewer_setting WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM me.viewer_theme WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM me.voucher_expiry_warning WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM feed.demotion WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION platform.erase_me_subject(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.erase_me_subject(text) TO yourtal_app;

-- ---------------------------------------------------------------------------
-- org_memberships: the subject's seat on a charity's roster, and the invitation
-- they accepted to join a business (it carries the email the invite went to).
-- Invitations the subject SENT stay: they hold the invitee's email, not the
-- subject's, and name the sender only by the opaque id the ledger also keeps.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.erase_org_memberships(subject text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, charity, business
AS $$
DECLARE
  total integer := 0;
  n integer;
BEGIN
  IF subject IS NULL OR length(subject) = 0 THEN
    RAISE EXCEPTION 'memberships: a subject is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  DELETE FROM charity.member WHERE user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM business.team_invitations WHERE accepted_by_user_id = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION platform.erase_org_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.erase_org_memberships(text) TO yourtal_app;

-- ---------------------------------------------------------------------------
-- watch_sessions: what the subject watched, how far, and the checkpoint answers
-- they gave. The domain map says `erase`; until now it had no handler, so a
-- deletion request reported it unhandled. Children first: the foreign keys from
-- coverage, checkpoint_nonce, checkpoint_issue and question_response all point
-- at watch.session. A subject that is not a uuid cannot own a session.
--
-- The ledger keeps the points it paid for a session, keyed by the session id
-- with no foreign key (F88): that history is anonymised, not erased.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.erase_watch_subject(subject text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, watch, campaign
AS $$
DECLARE
  subject_id uuid;
  total integer := 0;
  n integer;
BEGIN
  IF subject IS NULL OR length(subject) = 0 THEN
    RAISE EXCEPTION 'watch: a subject is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  BEGIN
    subject_id := subject::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN 0;
  END;

  DELETE FROM campaign.question_response
   WHERE session_id IN (SELECT id FROM watch.session WHERE user_id = subject_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM watch.checkpoint_nonce
   WHERE session_id IN (SELECT id FROM watch.session WHERE user_id = subject_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM watch.checkpoint_issue
   WHERE session_id IN (SELECT id FROM watch.session WHERE user_id = subject_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM watch.coverage
   WHERE session_id IN (SELECT id FROM watch.session WHERE user_id = subject_id);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM watch.session WHERE user_id = subject_id;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION platform.erase_watch_subject(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.erase_watch_subject(text) TO yourtal_app;
