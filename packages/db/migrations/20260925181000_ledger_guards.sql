-- 4.3: ledger guards. Each closes an audited defect (engine-money.md).
--
-- A superuser is exempt from the sealing rules, because it can bypass any
-- trigger anyway (session_replication_role) and the daily proof is what
-- catches superuser tampering. These rules bind the ledger role.

CREATE FUNCTION ledger.is_superuser() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT current_setting('is_superuser') = 'on' $$;

-- EM-14: a replay with a different payload must be refused, so the ledger
-- keeps what each key was first used for. NULL on rows from before this.
ALTER TABLE ledger.transfer ADD COLUMN request_hash bytea;

-- EM-18: created_at is the database's clock, never the caller's.
CREATE FUNCTION ledger.stamp_now() RETURNS trigger AS $$
BEGIN
  IF NOT ledger.is_superuser() THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transfer_stamp_now BEFORE INSERT ON ledger.transfer
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();
CREATE TRIGGER grant_stamp_now BEFORE INSERT ON ledger.grant
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();
CREATE TRIGGER point_purchase_stamp_now BEFORE INSERT ON ledger.point_purchase
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();

-- EM-09: an entry is in its account's currency. EM-18: an entry joins only a
-- transfer created in this same transaction, so a committed transfer is sealed.
CREATE FUNCTION ledger.entry_before_insert() RETURNS trigger AS $$
DECLARE
  account_currency char(3);
  transfer_xmin    xid;
BEGIN
  SELECT currency INTO account_currency FROM ledger.account WHERE id = NEW.account_id;
  IF account_currency IS NOT NULL AND account_currency <> NEW.currency THEN
    RAISE EXCEPTION 'ledger: a % entry cannot post to % account %',
      NEW.currency, account_currency, NEW.account_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT ledger.is_superuser() THEN
    NEW.created_at := now();
    SELECT xmin INTO transfer_xmin FROM ledger.transfer WHERE id = NEW.transfer_id;
    IF transfer_xmin IS DISTINCT FROM pg_current_xact_id()::xid THEN
      RAISE EXCEPTION 'ledger: transfer % is sealed; entries join only the transaction that created it',
        NEW.transfer_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entry_before_insert BEFORE INSERT ON ledger.entry
  FOR EACH ROW EXECUTE FUNCTION ledger.entry_before_insert();

-- EM-04: no debit takes a guarded account below zero: a user's available,
-- pending and escrow points, marketing cash, and a merchant's payable.
-- Checked at COMMIT under a per-account advisory lock, so two concurrent
-- debits are decided one after the other.
CREATE FUNCTION ledger.assert_no_overdraft() RETURNS trigger AS $$
DECLARE
  acct    ledger.account;
  balance numeric;
BEGIN
  SELECT * INTO acct FROM ledger.account WHERE id = NEW.account_id;
  IF NOT (acct.owner_type = 'user' OR acct.purpose = 'payable'
          OR acct.id ~ '^plat_(AU|ID)_marketing_cash$') THEN
    RETURN NULL;
  END IF;
  -- Only a debit in the account's normal direction can overdraw it.
  IF (acct.kind IN ('asset', 'expense')) = (NEW.amount_minor < 0) THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ledger.account:' || acct.id, 0));
  SELECT COALESCE(SUM(amount_minor), 0) INTO balance
    FROM ledger.entry WHERE account_id = acct.id AND currency = acct.currency;
  IF acct.kind IN ('asset', 'expense') THEN
    balance := -balance;
  END IF;
  IF balance < 0 THEN
    RAISE EXCEPTION 'ledger: overdraft on % (balance %)', acct.id, balance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER entry_no_overdraft_at_commit
  AFTER INSERT ON ledger.entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_no_overdraft();

-- EM-23: sum as numeric, so an overflowing tamper is reported as an
-- imbalance rather than an out-of-range error. Otherwise as 20260925180500.
CREATE OR REPLACE FUNCTION ledger.assert_transfer_balanced() RETURNS trigger AS $$
DECLARE
  imbalance numeric;
  entries   integer;
  regions   integer;
BEGIN
  SELECT COALESCE(SUM(e.amount_minor), 0), COUNT(*), COUNT(DISTINCT a.country)
    INTO imbalance, entries, regions
    FROM ledger.entry e
    JOIN ledger.account a ON a.id = e.account_id
   WHERE e.transfer_id = NEW.transfer_id;

  IF entries < 2 THEN
    RAISE EXCEPTION 'ledger: transfer % has % entries; double-entry needs at least 2',
      NEW.transfer_id, entries
      USING ERRCODE = 'check_violation';
  END IF;

  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'ledger: transfer % is unbalanced by %', NEW.transfer_id, imbalance
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM ledger.entry WHERE transfer_id = NEW.transfer_id
              GROUP BY currency HAVING COUNT(*) > 0 OFFSET 1) THEN
    RAISE EXCEPTION 'ledger: transfer % mixes currencies', NEW.transfer_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF regions > 1 THEN
    RAISE EXCEPTION 'ledger: transfer % crosses regions', NEW.transfer_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
