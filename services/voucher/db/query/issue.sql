-- name: InsertBatch :exec
INSERT INTO voucher.batch
  (id, listing_id, supplier_business_id, requested_by, quantity, face_value_minor,
   settlement_value_minor, currency, transferable, partial_redemption_policy,
   minimum_spend_minor, expires_at, funding_reference, state)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'requested');

-- name: ApproveBatch :one
-- The two-person rule as a statement rather than as a check the caller runs
-- first. `requested_by <> $2` in the WHERE means a self-approval matches NO
-- ROW — so the refusal is the same shape as the allocation drawdown in the
-- Reward Engine, and equally impossible to race past.
UPDATE voucher.batch
   SET approved_by = $2, approved_at = now(), state = 'approved'
 WHERE id = $1 AND state = 'requested' AND requested_by <> $2
RETURNING id, listing_id, supplier_business_id, requested_by, approved_by, quantity,
          face_value_minor, settlement_value_minor, currency, transferable,
          partial_redemption_policy, minimum_spend_minor, expires_at,
          funding_reference, manifest_sha256, state, created_at, approved_at;

-- name: GetBatch :one
SELECT id, listing_id, supplier_business_id, requested_by, approved_by, quantity,
       face_value_minor, settlement_value_minor, currency, transferable,
       partial_redemption_policy, minimum_spend_minor, expires_at,
       funding_reference, manifest_sha256, state, created_at, approved_at
FROM voucher.batch WHERE id = $1;

-- name: BeginMinting :one
-- Only an APPROVED batch may start minting, and only once. A second caller
-- finds the state already 'minting' and matches no row, which is what makes
-- "alerts on duplicate issuance" (YT-0141) a thing that cannot happen rather
-- than a thing that is noticed.
UPDATE voucher.batch SET state = 'minting'
 WHERE id = $1 AND state = 'approved'
RETURNING id, quantity, state;

-- name: CompleteMinting :exec
UPDATE voucher.batch SET state = 'minted', manifest_sha256 = $2
 WHERE id = $1 AND state = 'minting';

-- name: InsertVoucher :exec
-- No `owner_id`: a minted voucher belongs to nobody, and the column is NULL
-- until allocation. `vouchers_owner_iff_issued` ties the two facts, so a
-- minted row that named an owner would be refused.
--
-- `remaining_value_idr` is `$7` a second time rather than its own parameter.
-- A freshly minted voucher's remaining value IS its face value, and passing
-- them separately would let a caller mint one already partly spent.
INSERT INTO voucher.vouchers
  (id, listing_id, merchant_id, merchant_name, title, face_value_idr,
   remaining_value_idr, partial_redemption_policy, minimum_spend_idr, transferable,
   issued_at, expires_at, location_id, state, batch_id)
VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, now(), $10, $11, 'minted', $12);

-- name: InsertCodeCustody :exec
INSERT INTO voucher.code_custody
  (voucher_id, code_hash, wrapped_data_key, nonce, ciphertext, key_purpose, key_version)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: GetCodeCustody :one
SELECT voucher_id, code_hash, wrapped_data_key, nonce, ciphertext, key_purpose, key_version
FROM voucher.code_custody WHERE voucher_id = $1;

-- name: FindVoucherByCodeHash :one
-- The only way in from a code. Returns the voucher, never the custody row:
-- a redemption path has no reason to hold the ciphertext, and a query that
-- returned it would put the code in a log the first time somebody debugged
-- with %+v.
SELECT v.id, v.listing_id, v.owner_id, v.merchant_id, v.merchant_name, v.title,
       v.face_value_idr, v.remaining_value_idr, v.partial_redemption_policy,
       v.minimum_spend_idr, v.transferable, v.issued_at, v.expires_at,
       v.location_id, v.state, v.void_reason, v.batch_id, v.version
FROM voucher.vouchers v
JOIN voucher.code_custody c ON c.voucher_id = v.id
WHERE c.code_hash = $1;

-- name: GetVoucher :one
SELECT id, listing_id, owner_id, merchant_id, merchant_name, title, face_value_idr,
       remaining_value_idr, partial_redemption_policy, minimum_spend_idr,
       transferable, issued_at, expires_at, location_id, state, void_reason,
       batch_id, version
FROM voucher.vouchers WHERE id = $1;

-- name: TransitionVoucher :one
-- Optimistic concurrency (YT-0142). `version = $4` means a writer working
-- from a stale read matches no row and is told to re-read, rather than
-- overwriting a transition it never saw. Without it, a capture and a
-- kill-switch void racing on one voucher both succeed and the last writer
-- decides whether the money moved.
UPDATE voucher.vouchers
   SET state = $2,
       void_reason = $3,
       remaining_value_idr = $5,
       -- COALESCE, so a transition that is not an allocation leaves the
       -- owner alone. Passing the current owner back in would make every
       -- caller responsible for not accidentally re-owning the voucher.
       owner_id = COALESCE($6, owner_id),
       version = version + 1
 WHERE id = $1 AND version = $4
RETURNING id, state, void_reason, remaining_value_idr, owner_id, version;

-- name: InsertEvent :exec
INSERT INTO voucher.event
  (voucher_id, seq, event_type, detail, prev_hash, hash, occurred_at)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: ListEvents :many
-- Ordered by seq, which is the chain order. The hash of event N commits to
-- N-1, so any other ordering makes verification meaningless.
SELECT voucher_id, seq, event_type, detail, prev_hash, hash, occurred_at, created_at
FROM voucher.event WHERE voucher_id = $1 ORDER BY seq;

-- name: LatestEvent :one
SELECT voucher_id, seq, event_type, detail, prev_hash, hash, occurred_at, created_at
FROM voucher.event WHERE voucher_id = $1 ORDER BY seq DESC LIMIT 1;

-- name: GetListingTerms :one
-- The terms a voucher denormalises at issuance, plus the branch it is
-- honoured at. Joined to `listing_location` rather than read from the
-- listing alone because `voucher.vouchers` carries a COMPOSITE foreign key
-- to (listing_id, location_id) — a branch the listing does not serve is
-- unrepresentable, so it has to come from the join that proves it.
SELECT l.id, l.merchant_id, l.merchant_name, l.title, ll.location_id
FROM store.listings l
JOIN store.listing_location ll ON ll.listing_id = l.id
WHERE l.id = $1
ORDER BY ll.location_id
LIMIT 1;
