-- Group 2.10.b, F127 (docs/27 §3.3 and §3.6, migration B, the switch): from
-- here a receipt is paid by its partner's receipt package, and a receipt
-- package pays nothing but receipts. The ledger's drawReceipt and the
-- campaign paths enforce this; this trigger is the backstop. It checks each
-- new grant as it is inserted; grants already written are untouched.
CREATE FUNCTION ledger.assert_receipt_grant_funding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ledger, pg_temp AS $$
DECLARE
  from_package boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM ledger.receipt_package WHERE allocation_id = NEW.allocation_id)
    INTO from_package;
  IF (NEW.action_type = 'receipt_scanned') IS DISTINCT FROM from_package THEN
    RAISE EXCEPTION 'ledger: grant % (%) draws allocation %, and only a receipt may draw a receipt package',
      NEW.id, NEW.action_type, NEW.allocation_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION ledger.assert_receipt_grant_funding() FROM PUBLIC;

-- Not deferred: a grant's allocation and the package row both exist before
-- the grant is inserted, so the check needs nothing later in the transaction.
CREATE CONSTRAINT TRIGGER grant_receipt_funding AFTER INSERT ON ledger.grant
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_receipt_grant_funding();
