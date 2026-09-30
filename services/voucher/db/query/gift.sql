-- name: LockOwnedVoucher :one
-- 13.20: the voucher a gift or auction listing starts from, locked so two
-- concurrent sends of one voucher serialise here rather than race to void it.
SELECT id, listing_id, owner_id, merchant_id, merchant_name, title, face_value_minor,
       remaining_value_minor, partial_redemption_policy, minimum_spend_minor,
       transferable, issued_at, expires_at, location_id, state, void_reason,
       batch_id, version, currency, region
FROM voucher.vouchers
WHERE id = $1 AND owner_id = $2
FOR UPDATE;

-- name: LastActivatedAt :one
-- When the voucher last reached a wallet, for the transfer holdback.
SELECT occurred_at FROM voucher.event
WHERE voucher_id = $1 AND event_type = 'activated'
ORDER BY seq DESC
LIMIT 1;

-- name: ReceivedAsGift :one
-- One hop: a voucher someone accepted as a gift cannot be gifted again.
SELECT EXISTS (
  SELECT 1 FROM voucher.gift WHERE voucher_id = $1 AND state = 'accepted'
) AS received;

-- name: CountGiftsSentSince :one
SELECT count(*) FROM voucher.gift WHERE sender_id = $1 AND created_at >= $2;

-- name: CountGiftsReceivedSince :one
SELECT count(*) FROM voucher.gift WHERE recipient_id = $1 AND created_at >= $2;

-- name: GetGiftBySource :one
SELECT id, source_voucher_id, voucher_id, sender_id, recipient_id, region, state,
       created_at, expires_at, resolved_at
FROM voucher.gift WHERE source_voucher_id = $1;

-- name: InsertGift :exec
INSERT INTO voucher.gift (id, source_voucher_id, voucher_id, sender_id, recipient_id, region, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: LockGift :one
SELECT id, source_voucher_id, voucher_id, sender_id, recipient_id, region, state,
       created_at, expires_at, resolved_at
FROM voucher.gift WHERE id = $1
FOR UPDATE;

-- name: ResolveGift :one
UPDATE voucher.gift SET state = $2, resolved_at = now()
WHERE id = $1 AND state = 'pending'
RETURNING id;

-- name: ListGiftsForUser :many
-- Newest first. The joined voucher is the reminted one: its title and value
-- are what the gift is, whichever side is reading.
SELECT g.id, g.source_voucher_id, g.voucher_id, g.sender_id, g.recipient_id, g.region,
       g.state, g.created_at, g.expires_at, g.resolved_at,
       v.title, v.merchant_name, v.currency, v.face_value_minor, v.expires_at AS voucher_expires_at
FROM voucher.gift g
JOIN voucher.vouchers v ON v.id = g.voucher_id
WHERE g.sender_id = $1 OR g.recipient_id = $1
ORDER BY g.created_at DESC
LIMIT $2;

-- name: GetGiftView :one
SELECT g.id, g.source_voucher_id, g.voucher_id, g.sender_id, g.recipient_id, g.region,
       g.state, g.created_at, g.expires_at, g.resolved_at,
       v.title, v.merchant_name, v.currency, v.face_value_minor, v.expires_at AS voucher_expires_at
FROM voucher.gift g
JOIN voucher.vouchers v ON v.id = g.voucher_id
WHERE g.id = $1;

-- name: ListDueGifts :many
-- Pending gifts past their acceptance window, oldest first, one tick's worth.
SELECT id FROM voucher.gift
WHERE state = 'pending' AND expires_at <= now()
ORDER BY expires_at
LIMIT $1;

-- name: InsertRemintedVoucher :exec
-- Void-and-remint: a fresh voucher with the source's terms and a new code,
-- in `minted` with no owner until the caller moves it on. No batch: it was
-- never part of a batch's manifest. Only unused vouchers are reminted, so
-- the remaining value is the face value.
INSERT INTO voucher.vouchers
  (id, listing_id, merchant_id, merchant_name, title, face_value_minor,
   remaining_value_minor, partial_redemption_policy, minimum_spend_minor, transferable,
   issued_at, expires_at, location_id, state, batch_id, currency, region)
VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, now(), $10, $11, 'minted', NULL, $12, $13);
