-- 4.2: the chart of accounts per region, with a purpose on every account.
--
-- Sign convention (unchanged from 20260919000002): debits negative, credits
-- positive. Liability, equity and revenue balances read as +SUM; asset and
-- expense balances as -SUM.

-- A user holds three points accounts (available, pending, escrow); a merchant
-- holds a payable per currency. Everything else is `main`.
ALTER TABLE ledger.account ADD COLUMN purpose text NOT NULL DEFAULT 'main';

-- Existing user accounts were the spendable balance.
UPDATE ledger.account SET purpose = 'available' WHERE owner_type = 'user';

ALTER TABLE ledger.account
  ADD CONSTRAINT account_purpose_known
    CHECK (purpose IN ('main', 'available', 'pending', 'escrow', 'payable')),
  ADD CONSTRAINT account_user_purpose
    CHECK ((owner_type = 'user') = (purpose IN ('available', 'pending', 'escrow'))),
  ADD CONSTRAINT account_payable_is_merchant
    CHECK (purpose <> 'payable' OR owner_type = 'merchant');

-- AU and ID are separate economies: cash in a region is that region's
-- currency. NOT VALID because legacy test rows tagged an AUD reserve 'ID';
-- every new row is checked.
ALTER TABLE ledger.account
  ADD CONSTRAINT account_cash_in_its_region
    CHECK (currency = 'YTP' OR (currency = 'AUD' AND country = 'AU') OR (currency = 'IDR' AND country = 'ID'))
    NOT VALID;

DROP INDEX ledger.account_one_per_owner_currency;
CREATE UNIQUE INDEX account_one_per_owner_purpose
  ON ledger.account (owner_type, owner_id, currency, purpose)
  WHERE owner_type IN ('user', 'merchant', 'charity');

-- A reversal names the transfer it undoes, and a transfer is undone at most once.
ALTER TABLE ledger.transfer
  ADD COLUMN reverses text UNIQUE REFERENCES ledger.transfer (id);

-- The balance trigger also refuses a transfer that touches two regions, so
-- no posting can move value from one economy to the other.
CREATE OR REPLACE FUNCTION ledger.assert_transfer_balanced() RETURNS trigger AS $$
DECLARE
  imbalance bigint;
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
