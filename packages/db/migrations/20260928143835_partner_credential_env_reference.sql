-- TASKS.md 8.4.d (F73, security): 20260927190000_partner_actions.sql (never
-- edited -- migrations are append-only history) seeded
-- ('snap-app', 'local-only-snap-app-partner-secret-not-real') in the CLEAR.
-- That migration is public (the repo is public, F6), and it runs verbatim
-- on staging's real database -- so the value it wrote was never actually
-- secret there. Anyone who reads this repo could sign
-- POST /api/partners/actions as snap-app and mint marketing-funded points
-- on staging. Confirmed live: this is exactly how 8.2.e's own Check topped
-- up viewer.au (TASKS.md's own note on that line).
--
-- Hashing does not fix this: HMAC verification recomputes the MAC from the
-- CALLER's raw request bytes and the shared key, so it needs the actual key
-- material every time, not a one-way digest of it -- the same reasoning
-- 20260927190000's own header already gives for choosing plaintext over a
-- hash in the first place.
--
-- The fix is not "store it more carefully" but "stop storing the secret at
-- all": this table now holds a REFERENCE (an env var NAME) instead of a
-- VALUE. A reference reveals nothing on its own -- knowing that snap-app's
-- key lives in $SNAP_APP_PARTNER_SECRET is not the key -- so it is exactly
-- as safe to commit and to keep in a real database as
-- `platform.region_setting`'s own key column. This was chosen over sealing
-- the secret at rest (AES-256-GCM, the shape `business.webhook_subscription`
-- already uses) because sealing only moves the problem one layer down: the
-- encryption key protecting it would itself be a second secret this table,
-- or a sibling one, would have to hold -- and env vars, not the database,
-- are where every OTHER per-environment secret in this app already lives
-- (VOUCHER_SERVICE_SECRET, WEBHOOK_SECRET_ENCRYPTION_KEY, ...). One fewer
-- secret to protect, not one more.
--
-- The real per-environment value never touches this migration or any other
-- committed file: it is `SNAP_APP_PARTNER_SECRET`
-- (apps/api/src/config/env.schema.ts, .env.example), with a
-- local-only-safe default for dev and NO default once `apps/api` treats a
-- missing one as staging/production (the app refuses a request it cannot
-- verify rather than silently trusting an empty secret). Updated in place,
-- not deleted and reinserted: `platform.partner_receipt` holds a FK to this
-- row, and 'snap-app' itself does not change, only what it points to.
ALTER TABLE platform.partner_credential ADD COLUMN secret_env_var text;

UPDATE platform.partner_credential
   SET secret_env_var = 'SNAP_APP_PARTNER_SECRET'
 WHERE partner_id = 'snap-app';

ALTER TABLE platform.partner_credential ALTER COLUMN secret_env_var SET NOT NULL;
ALTER TABLE platform.partner_credential DROP COLUMN secret;
