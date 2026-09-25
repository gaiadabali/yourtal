-- 4.6.d, engine-voucher.md D8 and D9.

-- D8: a refund carries the merchant's own reference, once per capture, so a
-- retry under a new idempotency key cannot refund twice. NULL on old rows.
ALTER TABLE voucher.refund ADD COLUMN refund_ref text;
CREATE UNIQUE INDEX refund_once_per_ref ON voucher.refund (capture_id, refund_ref);

-- D9: every signature is accepted once. Rows older than the replay window
-- can never verify again, so the sweeper prunes them.
CREATE TABLE voucher.merchant_signature_seen (
  key_id  text        NOT NULL,
  mac     bytea       NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, mac)
);
CREATE INDEX merchant_signature_seen_at_idx ON voucher.merchant_signature_seen (seen_at);
GRANT SELECT, INSERT, DELETE ON voucher.merchant_signature_seen TO yourtal_voucher;
REVOKE ALL ON voucher.merchant_signature_seen FROM yourtal_app;
