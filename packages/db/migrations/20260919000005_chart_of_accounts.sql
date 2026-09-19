-- YT-0043: the chart of accounts.
--
-- docs/02 §6 specifies `kind {asset, liability, revenue, expense, equity}`
-- and `country` on the account, and an owner_type set wider than YT-0518
-- created. This migration brings the table up to that spec.
--
-- SCOPE: classification, not valuation. What an account IS — points
-- liability, breakage revenue, marketing expense — is unit-agnostic: points
-- liability is points liability whether an IDR integer is a rupiah or a sen.
-- What an account is WORTH involves the backing rate B and the coverage
-- ratio, which is pricing, and pricing is where YT-0506 actually bites.
-- Nothing here computes a value.

ALTER TABLE ledger.account
  ADD COLUMN kind    text,
  ADD COLUMN country text;

-- Backfill before the NOT NULL. Existing rows are test and seed accounts
-- created by YT-0042's suite, all owner_type='platform'; classifying them as
-- equity is the neutral choice for an account with no external claim on it.
UPDATE ledger.account SET kind = 'equity' WHERE kind IS NULL;
UPDATE ledger.account SET country = 'ID' WHERE country IS NULL;

ALTER TABLE ledger.account
  ALTER COLUMN kind SET NOT NULL,
  ALTER COLUMN country SET NOT NULL;

ALTER TABLE ledger.account
  ADD CONSTRAINT account_kind_known CHECK (
    kind IN ('asset', 'liability', 'revenue', 'expense', 'equity')),
  ADD CONSTRAINT account_country_known CHECK (country IN ('ID', 'AU'));

-- suspense and reserve join the set docs/02 §6 names. suspense is where a
-- transfer lands when its counterparty cannot yet be determined — it must
-- exist, because the alternative to a suspense account is a transfer that
-- does not balance, and an unbalanced transfer cannot be written at all.
ALTER TABLE ledger.account DROP CONSTRAINT IF EXISTS account_owner_type_check;
ALTER TABLE ledger.account
  ADD CONSTRAINT account_owner_type_known CHECK (
    owner_type IN ('user', 'merchant', 'platform', 'escrow', 'charity', 'suspense', 'reserve'));

-- docs/02 §6: currency {YTP, IDR, AUD}. Points are a currency in the ledger,
-- which is the point — an entry that moves points and an entry that moves
-- Rupiah cannot accidentally sum together, because a transfer may not mix
-- currencies (enforced by the trigger from YT-0518).
ALTER TABLE ledger.account
  ADD CONSTRAINT account_currency_known CHECK (currency IN ('YTP', 'IDR', 'AUD'));

-- An account is identified by what it is for, not only by its id.
CREATE INDEX account_kind_idx ON ledger.account (kind);
