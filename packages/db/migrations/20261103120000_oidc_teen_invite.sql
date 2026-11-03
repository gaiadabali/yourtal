-- Group 3.9.e (YourTal 14.16.d, docs/26 §3.3): the teen invite store. The table
-- came with 20261021025420_oidc_provider.sql; this adds what the invite API and
-- the sign-in check read by, and holds the row's states consistent.

-- A teen's standing invite into an app: read at every sign-in, token and userinfo.
CREATE INDEX teen_invite_teen_idx ON oidc.teen_invite (teen_user_id, sector)
  WHERE accepted_at IS NOT NULL AND ended_at IS NULL;

-- Accepted means by one teen, at one time; nothing else is ever half-set.
ALTER TABLE oidc.teen_invite
  ADD CONSTRAINT teen_invite_accepted_by_teen
    CHECK ((teen_user_id IS NULL) = (accepted_at IS NULL)),
  ADD CONSTRAINT teen_invite_ended_with_reason
    CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  ADD CONSTRAINT teen_invite_expiry_after_creation
    CHECK (expires_at > created_at);
