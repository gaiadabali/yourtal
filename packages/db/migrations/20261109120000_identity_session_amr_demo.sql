-- Staging test kit (K1 fix round M1/M3): a session made by the staging-only
-- demo sign-in (no password) carries amr {demo}, so sign-in-method changes and
-- OIDC clients other than SnapApp's staging ones can refuse it, and no client
-- is told a password was checked. Widens the allowed values only; production
-- never writes `demo` (the route is 404 there).
ALTER TABLE identity.session DROP CONSTRAINT session_amr_check;
ALTER TABLE identity.session ADD CONSTRAINT session_amr_check
  CHECK (cardinality(amr) > 0 AND amr <@ ARRAY['pwd', 'hwk', 'otp', 'mfa', 'demo']::text[]);
