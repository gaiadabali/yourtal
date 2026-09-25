-- 4.9.b: a backing rate is in force only once a second person approves it.
--
-- Approvals are their own append-only table, so backing_rate stays
-- insert-only. Rates never approved (every legacy test row) are proposals
-- and never price anything. A rate takes effect at the later of its
-- proposed time and its approval, recorded on the approval, so approving
-- late never changes a price retroactively.

CREATE TABLE ledger.backing_rate_approval (
  rate_id     text        PRIMARY KEY REFERENCES ledger.backing_rate (id),
  approved_by    text        NOT NULL,
  approved_at    timestamptz NOT NULL DEFAULT now(),
  effective_from timestamptz NOT NULL
);

CREATE INDEX backing_rate_approval_effective_idx ON ledger.backing_rate_approval (effective_from DESC);

GRANT SELECT, INSERT ON ledger.backing_rate_approval TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.backing_rate_approval FROM yourtal_ledger;
REVOKE ALL ON ledger.backing_rate_approval FROM yourtal_app;

-- A rate is never backdated: it takes effect at or after it was proposed,
-- on the database's clock.
CREATE TRIGGER backing_rate_stamp_now BEFORE INSERT ON ledger.backing_rate
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();
ALTER TABLE ledger.backing_rate
  ADD CONSTRAINT backing_rate_not_backdated CHECK (effective_from >= created_at) NOT VALID;

CREATE FUNCTION ledger.approve_backing_rate() RETURNS trigger AS $$
DECLARE
  proposed ledger.backing_rate;
  current_b bigint;
BEGIN
  IF NOT ledger.is_superuser() THEN
    NEW.approved_at := now();
  END IF;

  SELECT * INTO proposed FROM ledger.backing_rate WHERE id = NEW.rate_id;

  IF NEW.approved_by = proposed.set_by THEN
    RAISE EXCEPTION 'ledger: rate % needs a second person; % proposed it', NEW.rate_id, proposed.set_by
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.effective_from := GREATEST(proposed.effective_from, NEW.approved_at);

  -- A cut to B lowers every voucher's points price; locked quotes last
  -- 15 minutes, so a cut lands no sooner than that.
  SELECT r.micros_per_point INTO current_b
    FROM ledger.backing_rate r JOIN ledger.backing_rate_approval a ON a.rate_id = r.id
   WHERE r.currency = proposed.currency AND a.effective_from <= NEW.approved_at
   ORDER BY a.effective_from DESC LIMIT 1;
  IF current_b IS NOT NULL AND proposed.micros_per_point < current_b
     AND NEW.effective_from < NEW.approved_at + interval '15 minutes' THEN
    RAISE EXCEPTION 'ledger: a cut to B takes effect no sooner than 15 minutes after approval (rate %)', NEW.rate_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER backing_rate_approval_rules BEFORE INSERT ON ledger.backing_rate_approval
  FOR EACH ROW EXECUTE FUNCTION ledger.approve_backing_rate();

-- F1: the decided rates, in micros per point. ID B = IDR 6, P_issue = IDR 9;
-- AU B = 3 cents, P_issue = 4.5 cents. Staff change them through 9.5.
INSERT INTO ledger.backing_rate
  (id, currency, micros_per_point, issue_price_micros_per_point, effective_from, reason, set_by)
VALUES
  ('rate_f1_idr', 'IDR', 6000000, 9000000, now(), 'F1: decided 2026-09-25', 'founder'),
  ('rate_f1_aud', 'AUD', 3000000, 4500000, now(), 'F1: decided 2026-09-25', 'founder');
INSERT INTO ledger.backing_rate_approval (rate_id, approved_by, effective_from)
VALUES ('rate_f1_idr', 'plan-f1', now()), ('rate_f1_aud', 'plan-f1', now());
