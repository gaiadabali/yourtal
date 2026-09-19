-- YT-0130 groundwork: the monetary parameters the store is priced from.
--
-- docs/09 §12 ends with an instruction: "Build the ledger, the pricing
-- formula and the coverage dashboard BEFORE you build the store." This is
-- the storage half of that. The formula itself is Go, in the ledger service,
-- because docs/15 puts pricing and solvency there — the store may declare a
-- settlement value but it must never be able to decide a points price.
--
-- ## Why B is stored in micros rather than minor units
--
-- The backing rate B is "currency of value delivered per point". In IDR sen
-- (YT-0506) a plausible B of IDR 6/point is 600 sen — an integer. In AUD
-- cents a plausible B of 0.6 cents/point is NOT an integer, and the moment
-- one currency needs a fraction, every currency does, or the same formula
-- means two different things depending on where it runs.
--
-- So B is stored as MICRO-MINOR-UNITS per point: millionths of one minor
-- unit. IDR 6/point = 600 sen = 600_000_000. AUD 0.006 = 0.6 cents =
-- 600_000. Integer arithmetic throughout, no float ever touches a price.
--
-- ## Why the issue price lives on the same row
--
-- docs/09 §4.1: "B is a platform-set monetary parameter, never published to
-- users, ALWAYS LESS THAN the average issuance price P_issue. The spread is
-- the margin." A B at or above P_issue means the platform settles suppliers
-- for more than it collected, on every redemption, structurally — the exact
-- failure §4 is written to prevent, except arriving from our own side of the
-- table instead of a supplier's.
--
-- Recording P_issue as a declared figure next to B is what turns that
-- sentence into a constraint. It is not a computed average of actual sales:
-- the rate must be settable before the first sale exists, and a parameter
-- that silently re-derives itself from traffic is one nobody can reason
-- about. It is the price the platform is committing to sell points at while
-- this rate is in force, and the check below refuses the pair if the spread
-- is not there.

CREATE TABLE ledger.backing_rate (
  id                          text        PRIMARY KEY,
  currency                    char(3)     NOT NULL CHECK (currency IN ('IDR', 'AUD')),

  -- B, in millionths of one minor unit per point. See the header.
  micros_per_point            bigint      NOT NULL CHECK (micros_per_point > 0),

  -- P_issue, same unit. What a partner pays per point while this rate holds.
  issue_price_micros_per_point bigint     NOT NULL CHECK (issue_price_micros_per_point > 0),

  -- Effective-dated rather than mutable. Changing B is a DEVALUATION
  -- (docs/09 §6 lever 3, the one marked "High — announce it, never do it
  -- silently"), so the history of what the rate has been must survive the
  -- change. An UPDATE would destroy the only record of what a voucher sold
  -- under last month.
  effective_from              timestamptz NOT NULL,

  -- Why this rate. docs/09 §6 requires a devaluation to be announced; a
  -- reason column is where the announcement is attached to the act, so an
  -- unexplained rate change is visibly an unexplained rate change.
  reason                      text        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  set_by                      text        NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),

  -- THE structural margin guarantee, as a constraint rather than a norm.
  CONSTRAINT backing_rate_below_issue_price CHECK (
    micros_per_point < issue_price_micros_per_point
  ),

  -- One rate per currency per instant. Two rows sharing an effective_from
  -- would make "the rate in force" a question with two answers, and the
  -- resolution would fall to whichever ORDER BY the reader happened to
  -- write.
  CONSTRAINT backing_rate_one_per_instant UNIQUE (currency, effective_from)
);

-- The lookup every price does: latest row for a currency at or before now.
CREATE INDEX backing_rate_currency_effective_idx
  ON ledger.backing_rate (currency, effective_from DESC);

-- Value-zone, so the same grants as everything else in `ledger`: the ledger
-- role writes, and nothing else can see it at all. The store service asks
-- the pricing endpoint for a price; it cannot read B and compute one itself,
-- which is what keeps "a supplier can never set a points price" (YT-0130)
-- true by grant rather than by everyone remembering.
GRANT SELECT, INSERT ON ledger.backing_rate TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.backing_rate FROM yourtal_ledger;
REVOKE ALL ON ledger.backing_rate FROM yourtal_app;
