-- 5.1.d (F86): a bidder's saved card is a user's personal data, so account
-- deletion must erase it. payment.customer, payment.saved_card and
-- payment.card_setup hold a customer id, a card reference, brand, last four,
-- expiry and the page a setup returned to, all keyed by the owner.
--
-- The app role has SELECT, INSERT and UPDATE on these tables and no DELETE, and
-- must not get one: a business's card (owner_kind 'business') is not something
-- the app deletes. This function is SECURITY DEFINER, owned by the tables'
-- owner (like platform.forget_partner_subject), with the search_path pinned and
-- EXECUTE granted only to yourtal_app. It deletes rows for one subject and
-- only where the owner is a user, so the app gains the ability to erase a named
-- person's card and nothing else. Idempotent: a second call finds nothing.
--
-- No table, column or grant is added, so there is no region wall to extend.
CREATE FUNCTION platform.erase_payment_subject(subject text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, payment
AS $$
DECLARE
  total integer := 0;
  n integer;
BEGIN
  IF subject IS NULL OR length(subject) = 0 THEN
    RAISE EXCEPTION 'payment: a subject is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  DELETE FROM payment.saved_card WHERE owner_kind = 'user' AND owner_id::text = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM payment.card_setup WHERE owner_kind = 'user' AND owner_id::text = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM payment.customer WHERE owner_kind = 'user' AND owner_id::text = subject;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION platform.erase_payment_subject(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.erase_payment_subject(text) TO yourtal_app;
