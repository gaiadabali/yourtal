-- YT-0046: partner point pre-purchase.
--
-- ## Record the pair; never compute one from the other
--
-- A purchase has two facts: N points allocated, and X currency received. The
-- commercial agreement sets BOTH — so there is nothing to compute, and
-- `P_issue` is an OUTPUT of the pair (X / N) rather than an input to a
-- conversion. Storing only one and deriving the other would need a rate, and
-- a rate is exactly what YT-0506 gates.
--
-- The upside of recording both: when YT-0506 resolves, `B` can be DERIVED
-- FROM HISTORY rather than assumed, because every real purchase already has
-- both sides on the record. Recording only points would have thrown that
-- away permanently.
--
-- Note there is no `price_per_point` column, deliberately. A stored quotient
-- is a third fact that can disagree with the two it came from, and when it
-- does, the two are right and the quotient is the bug — the same argument
-- that keeps `Balance` a projection rather than a column.

CREATE TABLE ledger.point_purchase (
  id              text        PRIMARY KEY,
  partner_id      text        NOT NULL,
  -- Fact one: how many points this bought.
  points          bigint      NOT NULL CHECK (points > 0),
  -- Fact two: what was paid, currency-tagged, in minor units. Tagged because
  -- the platform runs two currencies (docs/02 §6) and an untagged amount is
  -- a number nobody can settle against.
  amount_minor    bigint      NOT NULL CHECK (amount_minor > 0),
  currency        char(3)     NOT NULL CHECK (currency IN ('IDR', 'AUD')),
  -- The points side: the allocation the Reward Engine draws down.
  allocation_id   text        NOT NULL UNIQUE REFERENCES ledger.allocation (id),
  -- The cash side: the reserve posting. A separate transfer because the two
  -- sides are in different currencies and a transfer may not mix them — so
  -- this row is what ties them together, and it is the audit trail the AC
  -- asks for.
  cash_transfer_id text       NOT NULL REFERENCES ledger.transfer (id),
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- One purchase per partner reference, so a retried purchase cannot create
  -- a second allocation for the same money.
  CONSTRAINT point_purchase_partner_ref UNIQUE (partner_id, id)
);

CREATE INDEX point_purchase_partner_idx ON ledger.point_purchase (partner_id);

GRANT SELECT, INSERT ON ledger.point_purchase TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.point_purchase FROM yourtal_ledger;
