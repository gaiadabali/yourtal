-- 4.6.a, D3: the voucher lifecycle is enforced by the database on every
-- write, not only by the Go table. `voucher.transition_allowed` mirrors
-- services/voucher/internal/lifecycle.Transitions; a Go test asserts the two
-- agree for every pair of states.

CREATE FUNCTION voucher.transition_allowed(from_state text, to_state text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT (from_state, to_state) IN (
    ('minted', 'allocated'), ('minted', 'voided'), ('minted', 'expired'),
    ('allocated', 'active'), ('allocated', 'voided'), ('allocated', 'expired'),
    ('active', 'held'), ('active', 'redeemed'), ('active', 'expired'), ('active', 'voided'),
    ('held', 'active'), ('held', 'redeemed'), ('held', 'voided'),
    ('expired', 'active')
  )
$$;

CREATE FUNCTION voucher.assert_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.state = NEW.state THEN
    -- A refund restores value to an active voucher; an edit that moves no
    -- value and no version (a DSAR owner anonymisation) is not a lifecycle
    -- move. Anything else in place is held -> held and friends: refused.
    IF NEW.state = 'active'
       OR (NEW.remaining_value_minor = OLD.remaining_value_minor AND NEW.version = OLD.version) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NOT voucher.transition_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'voucher: illegal voucher transition % -> % (voucher %)', OLD.state, NEW.state, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vouchers_transition_allowed BEFORE UPDATE ON voucher.vouchers
  FOR EACH ROW EXECUTE FUNCTION voucher.assert_transition();
