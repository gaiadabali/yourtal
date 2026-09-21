-- YT-0582: the only storage that backs any of the four principal
-- attributes `policies/_schemas/principal.json` declares and
-- `PrincipalService.resolve()` has never been able to populate.
--
-- Scoped to ONE attribute on purpose: `valueFrozenUntil`, the 72h SIM-swap /
-- account-recovery freeze from docs/14 section 5. The other three are
-- deliberately NOT added here --
--   - `reauthenticatedAt` and `hasPasskey` are step-up-auth state that
--     belongs with the identity/auth work (YT-0500 follow-on, YT-0540/0541),
--     not invented as a side effect of this ticket.
--   - `goodwillCreditCeilingIdr` is an economy-owned number (YT-0050); the
--     founder holds that ceiling, and a migration is exactly the kind of
--     silent decision the account-freeze audit that opened this ticket was
--     written to stop.
-- Adding either class of column here would be the same mistake YT-0576
-- flagged: an authorization-adjacent number decided by whoever happened to
-- be holding the migration, not by whoever owns it.
--
-- Lives in a new `identity` schema rather than `business` or `platform`:
-- this is principal-level state, not business-scoped (`business.*`) and not
-- infrastructure shared by every domain the way idempotency is
-- (`platform.*`) -- it is the first table for the identity domain, which
-- has no home yet because identity itself is still interim
-- (`PrincipalService`'s own doc comment, pending YT-0032/Zitadel).
--
-- No FK to a `users` table: there isn't one. `user_id` is a free-text
-- identifier threaded through `business.business_members`,
-- `ledger.account`, etc. with no canonical identity table backing it
-- anywhere in this repo today (verified by search before writing this).

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE identity.principal_security_state (
  user_id             text        PRIMARY KEY,

  -- RFC3339. NULL means "never frozen" -- absence is the correct default
  -- for almost every principal, which is exactly why
  -- `policies/derived_roles/common.yaml`'s `account_owner_in_good_standing`
  -- checks `!has(...)` rather than requiring presence. This column must
  -- stay nullable; do not default it to anything that would fake a value.
  value_frozen_until  timestamptz,

  updated_at          timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA identity TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.principal_security_state TO yourtal_app;
