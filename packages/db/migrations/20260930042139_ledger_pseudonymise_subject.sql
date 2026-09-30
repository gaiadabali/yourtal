-- 13.24: account deletion severs a subject from the ledger's personal data
-- without touching its history. Transfers, entries and grant amounts stay as
-- they are (the daily proof covers them); the device and IP a grant recorded
-- are the only personal data in `ledger.grant`, so they are cleared.
--
-- SECURITY DEFINER, owned by the ledger tables' owner, like
-- voucher.anonymise_owner: `yourtal_app` may call it but holds no UPDATE on
-- the ledger, and the function can only ever clear those two columns for
-- one subject. It sits in `platform` because the app has no USAGE on the
-- `ledger` schema, and the search_path is pinned like that function's.
CREATE FUNCTION platform.pseudonymise_ledger_subject(subject text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ledger
AS $$
DECLARE
  cleared integer;
BEGIN
  IF subject IS NULL OR length(subject) = 0 THEN
    RAISE EXCEPTION 'ledger: a subject is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE ledger."grant"
     SET device_id = NULL, ip_address = NULL
   WHERE user_id = subject
     AND (device_id IS NOT NULL OR ip_address IS NOT NULL);

  GET DIAGNOSTICS cleared = ROW_COUNT;
  RETURN cleared;
END;
$$;

REVOKE ALL ON FUNCTION platform.pseudonymise_ledger_subject(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.pseudonymise_ledger_subject(text) TO yourtal_app;
