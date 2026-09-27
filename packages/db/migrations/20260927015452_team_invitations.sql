-- TASKS.md 7.1.c: email invites for a business's team, replacing the old
-- userId-only invite. The invitee need not have an account yet -- the row
-- is keyed by email and a token, not a user id -- and acceptance is a
-- separate step once they are signed in (`accepted_by_user_id`/
-- `accepted_at`), the same shape identity.verification_token already uses
-- for password-reset/email-verification tokens (20260925201000-adjacent).

CREATE TABLE business.team_invitations (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          uuid        NOT NULL REFERENCES business.business_accounts (id),
  email                text        NOT NULL,
  -- Same grantable-role set as business_members.role, minus 'owner' --
  -- ownership moves only through transfer, never an invite (docs/17 2.1).
  role                 text        NOT NULL CHECK (
                         role IN ('admin','marketer','merchandiser','finance','analyst')),
  token_hash           text        NOT NULL,
  invited_by_user_id   text        NOT NULL,
  invited_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  accepted_at          timestamptz,
  accepted_by_user_id  text,
  revoked_at           timestamptz
);

CREATE UNIQUE INDEX team_invitations_token_hash_key ON business.team_invitations (token_hash);

-- At most one OPEN (unaccepted, unrevoked) invitation per business+email --
-- a second invite to the same address replaces intent, not adds to it.
CREATE UNIQUE INDEX team_invitations_open_business_email
  ON business.team_invitations (business_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX team_invitations_business_idx ON business.team_invitations (business_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON business.team_invitations TO yourtal_app;
