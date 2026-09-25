-- 4.4.h, K6: every point not paid for by a business is backed by cash at the
-- moment of issue (engine-money.md EM-02).

-- Marketing cash is the platform's own money earmarked for marketing points.
-- It is increased only by a funding decision made by two different people.
CREATE TABLE ledger.marketing_funding (
  id           text        PRIMARY KEY,
  region       text        NOT NULL CHECK (region IN ('AU', 'ID')),
  amount_minor bigint      NOT NULL CHECK (amount_minor > 0),
  proposed_by  text        NOT NULL,
  approved_by  text        NOT NULL,
  transfer_id  text        NOT NULL UNIQUE REFERENCES ledger.transfer (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_funding_two_people CHECK (approved_by <> proposed_by)
);

GRANT SELECT, INSERT ON ledger.marketing_funding TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.marketing_funding FROM yourtal_ledger;
REVOKE ALL ON ledger.marketing_funding FROM yourtal_app;

-- An increase to marketing cash (a debit: it is an asset) must be the
-- transfer a marketing_funding row records. Checked at COMMIT, because the
-- funding row references the transfer and is written after it.
CREATE FUNCTION ledger.assert_marketing_cash_funded() RETURNS trigger AS $$
BEGIN
  IF NEW.account_id ~ '^plat_(AU|ID)_marketing_cash$' AND NEW.amount_minor < 0
     AND NOT EXISTS (SELECT 1 FROM ledger.marketing_funding WHERE transfer_id = NEW.transfer_id) THEN
    RAISE EXCEPTION 'ledger: marketing cash increases only through fundMarketing (transfer %)', NEW.transfer_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER entry_marketing_cash_funded_at_commit
  AFTER INSERT ON ledger.entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_marketing_cash_funded();

-- A partner allocation exists only because a partner bought the points:
-- RecordPurchase writes the allocation and its point_purchase together.
CREATE FUNCTION ledger.assert_partner_allocation_purchased() RETURNS trigger AS $$
BEGIN
  IF NEW.funder_type = 'partner'
     AND NOT EXISTS (SELECT 1 FROM ledger.point_purchase WHERE allocation_id = NEW.id) THEN
    RAISE EXCEPTION 'ledger: partner allocation % has no point purchase behind it', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER allocation_partner_purchased_at_commit
  AFTER INSERT ON ledger.allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_partner_allocation_purchased();
