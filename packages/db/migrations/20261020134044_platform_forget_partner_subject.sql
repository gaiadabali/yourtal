-- 14.3 follow-up: account deletion and partner links (the `partner_links`
-- DSAR domain). For one subject it:
--   * revokes every active partner link, so a partner calling with one gets
--     `link_revoked` and nothing is paid. The row stays, keyed only by the
--     opaque user id whose identity rows the `identity` domain erases, as
--     the ledger's rows do (13.24, F88);
--   * detaches the subject from every receipt it reported (the nil-UUID
--     tombstone `voucher.anonymise_owner` uses). The receipt row itself
--     stays: a receipt earns once (F101), so its hash must outlive the
--     account or the same receipt could be paid again to someone else;
--   * deletes every link code the subject was issued. Nothing refers to a
--     code once it is spent, and an unspent one must not link a deleted
--     account.
--
-- SECURITY DEFINER, owned by the tables' owner, like
-- voucher.anonymise_owner and platform.pseudonymise_ledger_subject: the app
-- may call it but gets no DELETE on me.link_code and no UPDATE on
-- partner_receipt.user_id, and the function can only ever write the
-- tombstone, for one subject. The search_path is pinned the same way.
CREATE FUNCTION platform.forget_partner_subject(subject text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, me
AS $$
DECLARE
  revoked integer;
  detached integer;
  deleted integer;
BEGIN
  IF subject IS NULL OR length(subject) = 0 THEN
    RAISE EXCEPTION 'partners: a subject is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE platform.partner_link
     SET revoked_at = now()
   WHERE user_id = subject
     AND revoked_at IS NULL;
  GET DIAGNOSTICS revoked = ROW_COUNT;

  UPDATE platform.partner_receipt
     SET user_id = '00000000-0000-0000-0000-000000000000'
   WHERE user_id::text = subject;
  GET DIAGNOSTICS detached = ROW_COUNT;

  DELETE FROM me.link_code WHERE user_id = subject;
  GET DIAGNOSTICS deleted = ROW_COUNT;

  RETURN revoked + detached + deleted;
END;
$$;

REVOKE ALL ON FUNCTION platform.forget_partner_subject(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.forget_partner_subject(text) TO yourtal_app;
