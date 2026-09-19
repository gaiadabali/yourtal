-- YT-0036 / YT-0528: let the application anonymise a voucher's owner without
-- letting it re-own one.
--
-- ## The problem this closes
--
-- YT-0142 narrowed `yourtal_app` to SELECT on `voucher.vouchers`, because
-- issuance and state changes are the voucher service's. That narrowing was
-- right, and it broke a right-to-erasure request: `anonymiseVouchers` sets
-- `owner_id` to a tombstone, and the app can no longer write the column.
--
-- A voucher is ANONYMISED rather than erased because a merchant is owed
-- settlement for a redemption that actually happened — deleting the row
-- would delete the evidence of a debt owed to somebody who is not the
-- subject. So the operation has to keep working.
--
-- ## Why not `GRANT UPDATE (owner_id)`
--
-- The obvious fix is a column-level grant, and it looks precise: the app
-- could change who holds a voucher and not what it is worth. The property
-- everyone wants stated is *"the app may sever a subject from an instrument;
-- it may not alter what the instrument is worth."*
--
-- **A column grant does not express that property.** It permits any value in
-- that column, and `SET owner_id = <tombstone>` and `SET owner_id =
-- <attacker>` are the same statement with a different parameter. For a
-- BEARER instrument the holder is not an attribute of the value, the holder
-- IS who gets the money — so a grant that lets the application choose an
-- owner hands anyone with the application credential the entire voucher
-- float. Value, expiry and state stay untouched while the vouchers change
-- hands, which is the theft, not a mitigation of it.
--
-- ## Why not "run erasure as the owner"
--
-- Also rejected, and for a better reason than it first appears: erasure is a
-- **production request handler triggered by a user**, not an administrative
-- batch like seeding. Giving that path the database owner's credential is
-- risk 45 in miniature — the app holding authority it does not need — on the
-- same day that was named a launch blocker.
--
-- ## What this does instead
--
-- A SECURITY DEFINER function with the destination BAKED IN. The app may
-- call it; it cannot choose where the voucher lands, because the tombstone
-- is a constant in the body rather than a parameter. The app keeps no UPDATE
-- on the table at all.
--
-- The function is owned by `yourtal_voucher`, not by the database owner, so
-- its definer rights are exactly the voucher service's and nothing more. A
-- SECURITY DEFINER function owned by a superuser would re-introduce the
-- problem it was written to avoid, one layer down.
--
-- `search_path` is pinned, because a SECURITY DEFINER function that resolves
-- its own table names through the caller's search_path can be pointed at a
-- different table by the caller — the standard and entirely practical attack
-- on this feature.

CREATE OR REPLACE FUNCTION voucher.anonymise_owner(subject uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, voucher
AS $$
DECLARE
  severed integer;
BEGIN
  -- The NIL uuid, matching TOMBSTONE in packages/db/src/dsar-handlers.ts.
  -- Nil rather than NULL: a NULL owner reads as "we never knew", and the
  -- truth is "we knew and were asked to forget".
  --
  -- Refusing the tombstone as an argument is the whole control: a caller
  -- asking to anonymise the tombstone itself would be a no-op today, and a
  -- way to enumerate whether anonymisation had run tomorrow.
  IF subject = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'voucher: the tombstone is not a subject'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE voucher.vouchers
     SET owner_id = '00000000-0000-0000-0000-000000000000'::uuid
   WHERE owner_id = subject;

  GET DIAGNOSTICS severed = ROW_COUNT;
  RETURN severed;
END;
$$;

ALTER FUNCTION voucher.anonymise_owner(uuid) OWNER TO yourtal_voucher;

-- PUBLIC gets EXECUTE on a new function by default, which would make the
-- pinned ownership above decorative.
REVOKE ALL ON FUNCTION voucher.anonymise_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voucher.anonymise_owner(uuid) TO yourtal_app;
