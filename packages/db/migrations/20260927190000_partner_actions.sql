-- TASKS.md 8.4.a: snap-app (the first partner integration, docs/16) calls
-- POST /api/partners/actions, authenticated by a partner-wide HMAC secret
-- (never a session, never Cerbos -- an external system, not a principal).
-- `platform` because more than one module could plausibly gain a partner
-- later (docs/15's own reasoning for platform.sim_outbox).

-- `secret`, not a hash: HMAC verification needs the actual key material to
-- recompute the same MAC a partner's own call signed with -- a one-way hash
-- cannot do that (the same reason services/voucher's own merchant
-- credential is envelope-encrypted rather than hashed, docs/09 §8.1). One
-- hardcoded dev row, simulated data only (Helios red line 11), so plaintext
-- here rather than building the full envelope-encryption machinery
-- `internal/keyring` (Go) has for a single row nothing external ever reads.
CREATE TABLE platform.partner_credential (
  partner_id   text        PRIMARY KEY,
  secret       text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- "the receipt hash is unique per (partner, hash)" -- TASKS.md's own words.
-- Recording the grantId too so a replay (idempotency key collision on the
-- ledger side) can still answer "what happened" without a second ledger call.
CREATE TABLE platform.partner_receipt (
  partner_id     text        NOT NULL REFERENCES platform.partner_credential (partner_id),
  receipt_hash   text        NOT NULL,
  user_id        uuid        NOT NULL,
  external_ref   text        NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (partner_id, receipt_hash)
);

GRANT SELECT ON platform.partner_credential TO yourtal_app;
GRANT SELECT, INSERT ON platform.partner_receipt TO yourtal_app;

-- snap-app (docs/16): a sister company, the first and so far only partner
-- integration -- a fixed dev credential, the same "local-only, not a real
-- secret" convention .env.example already uses.
INSERT INTO platform.partner_credential (partner_id, secret) VALUES
  ('snap-app', 'local-only-snap-app-partner-secret-not-real');
