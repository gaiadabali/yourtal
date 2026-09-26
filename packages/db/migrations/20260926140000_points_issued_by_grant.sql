-- 4.10.b (EM-02): points are issued only by a grant. A transfer that debits
-- points_issued (partner points) or marketing_expense (platform points) must
-- be named by a ledger.grant row, of that many points, from an allocation of
-- the matching funder, all by the time it commits. Before this the ledger
-- role could post the grant entries bare, with no grant and no allocation.
CREATE FUNCTION ledger.assert_points_issued_by_grant() RETURNS trigger AS $$
DECLARE
  partner_points   bigint;
  marketing_points bigint;
BEGIN
  SELECT COALESCE(-SUM(e.amount_minor) FILTER (WHERE e.account_id ~ '^plat_(AU|ID)_points_issued$'), 0),
         COALESCE(-SUM(e.amount_minor) FILTER (WHERE e.account_id ~ '^plat_(AU|ID)_marketing_expense$'), 0)
    INTO partner_points, marketing_points
    FROM ledger.entry e
   WHERE e.transfer_id = NEW.id AND e.amount_minor < 0;
  IF partner_points = 0 AND marketing_points = 0 THEN
    RETURN NULL;
  END IF;
  IF partner_points <> COALESCE((SELECT SUM(g.points) FROM ledger.grant g
        JOIN ledger.allocation a ON a.id = g.allocation_id
       WHERE g.transfer_id = NEW.id AND a.funder_type = 'partner'), 0)
     OR marketing_points <> COALESCE((SELECT SUM(g.points) FROM ledger.grant g
        JOIN ledger.allocation a ON a.id = g.allocation_id
       WHERE g.transfer_id = NEW.id AND a.funder_type = 'marketing'), 0) THEN
    RAISE EXCEPTION 'ledger: transfer % issues points no grant accounts for', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER transfer_points_issued_by_grant AFTER INSERT ON ledger.transfer
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_points_issued_by_grant();
