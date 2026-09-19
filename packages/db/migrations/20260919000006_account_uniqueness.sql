-- YT-0043: correct the account uniqueness rule.
--
-- YT-0518 created `UNIQUE (owner_type, owner_id, currency)`, which encodes
-- "one account per owner per currency". That is right for a USER — a person
-- has exactly one points balance, and two would make "their balance" an
-- ambiguous question — and wrong for the PLATFORM, which needs several
-- points accounts at once: issued, redeemed, breakage revenue, marketing
-- expense. That is the entire point of a chart of accounts.
--
-- Found by building the chart and watching Postgres refuse it. The
-- constraint was a reasonable guess when the only accounts were a test's
-- from/to pair, and it was never true of the real model.
--
-- Replaced with a PARTIAL unique index covering the owner types that really
-- do have exactly one account per currency. Platform, escrow, reserve and
-- suspense are excluded: for those, the meaningful identity is the account
-- id, which is why the chart uses stable readable ones (plat_breakage_revenue
-- rather than a uuid) instead of looking accounts up by owner.

ALTER TABLE ledger.account DROP CONSTRAINT IF EXISTS account_owner_unique;

CREATE UNIQUE INDEX account_one_per_owner_currency
  ON ledger.account (owner_type, owner_id, currency)
  WHERE owner_type IN ('user', 'merchant', 'charity');
