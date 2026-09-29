-- TASKS.md 10.2.b: the expiry sweep and its ledger-posting outbox.

-- name: ListVouchersDueForExpiry :many
-- Active vouchers past their own expires_at. A dead hold (an authorization
-- that timed out) is released back to Active by the existing
-- SweepExpiredHolds first (release.go) -- this query then covers it on its
-- own next pass, the same as any other active voucher.
SELECT id FROM voucher.vouchers
 WHERE state = 'active' AND expires_at <= now()
 ORDER BY expires_at
 LIMIT $1;

-- name: InsertExpiryOutbox :exec
INSERT INTO voucher.expiry_outbox (voucher_id, region, amount_minor, currency)
VALUES ($1, $2, $3, $4)
ON CONFLICT (voucher_id) DO NOTHING;

-- name: ListUnpostedExpiryOutbox :many
SELECT voucher_id, region, amount_minor, currency
FROM voucher.expiry_outbox
WHERE posted_at IS NULL
ORDER BY created_at
LIMIT $1;

-- name: MarkExpiryOutboxPosted :exec
UPDATE voucher.expiry_outbox SET posted_at = now() WHERE voucher_id = $1;
