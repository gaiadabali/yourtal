-- 4.4.i, EM-11: the spread must cover the 0.80 demand floor, B <= 0.8 x P_issue,
-- written as B x 1.25 <= P_issue in integers. NOT VALID: legacy test rows
-- are append-only history; every new rate is checked.
ALTER TABLE ledger.backing_rate
  ADD CONSTRAINT backing_rate_margin
    CHECK (micros_per_point * 5 <= issue_price_micros_per_point * 4) NOT VALID;
