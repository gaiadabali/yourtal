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
-- YT-0571 audit: no owner predicate, considered rather than silent. Its one
-- caller (issue.go's Mint) reads batchID immediately after BeginMinting has
-- already atomically claimed that exact id by id AND state = 'approved', in
-- the SAME transaction — this is not an independent lookup on a
-- fresh client-supplied id, it is re-reading the row this transaction just
-- proved it owns. A supplier/owner predicate belongs on BeginMinting's own
-- WHERE clause if this package ever gains a caller that supplies a batch id
-- without having claimed it first.
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
-- `remaining_value_minor` is `$7` a second time rather than its own
-- parameter. A freshly minted voucher's remaining value IS its face value,
-- and passing them separately would let a caller mint one already partly
-- spent.
--
-- `currency` ($13) is the batch's currency (batch.currency, itself carried
-- from the listing at RequestBatch time) — a voucher is denominated in
-- whatever its batch was, not re-derived at mint time.
INSERT INTO voucher.vouchers
  (id, listing_id, merchant_id, merchant_name, title, face_value_minor,
   remaining_value_minor, partial_redemption_policy, minimum_spend_minor, transferable,
   issued_at, expires_at, location_id, state, batch_id, currency)
VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, now(), $10, $11, 'minted', $12, $13);

-- name: InsertCodeCustody :exec
INSERT INTO voucher.code_custody
  (voucher_id, code_hash, wrapped_data_key, nonce, ciphertext, key_purpose, key_version)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: GetCodeCustody :one
-- YT-0571 audit: no owner predicate. Its only caller is Reveal
-- (allocate.go), whose own doc comment already names the deal: "the caller
-- is responsible for having established that the requester owns the
-- voucher; this package will not guess at that." That is a considered
-- absence carried at the Go layer rather than here, because the decryption
-- key purpose lives in this package and an authorisation check made in the
-- layer that holds the plaintext is one nobody reviews (allocate.go's own
-- words) — scoping this query would not remove that responsibility, only
-- hide where it is discharged.
SELECT voucher_id, code_hash, wrapped_data_key, nonce, ciphertext, key_purpose, key_version
FROM voucher.code_custody WHERE voucher_id = $1;

-- name: FindVoucherByCodeHash :one
-- The only way in from a code. Returns the voucher, never the custody row:
-- a redemption path has no reason to hold the ciphertext, and a query that
-- returned it would put the code in a log the first time somebody debugged
-- with %+v.
--
-- YT-0571 audit: deliberately no predicate beyond the hash itself.
-- Possessing the code IS the credential — the whole redemption model is
-- "whoever presents a valid code may redeem it up to the merchant it
-- names," checked afterwards in `check()`, not here. A merchant predicate
-- on this query would ask "does this code belong to you" before the code
-- has even been read, which is a question this table cannot answer: a
-- code is not owned by a merchant, a voucher's REMAINING VALUE is, and that
-- is what `check()` compares.
SELECT v.id, v.listing_id, v.owner_id, v.merchant_id, v.merchant_name, v.title,
       v.face_value_minor, v.remaining_value_minor, v.partial_redemption_policy,
       v.minimum_spend_minor, v.transferable, v.issued_at, v.expires_at,
       v.location_id, v.state, v.void_reason, v.batch_id, v.version, v.currency
FROM voucher.vouchers v
JOIN voucher.code_custody c ON c.voucher_id = v.id
WHERE c.code_hash = $1;

-- name: GetVoucher :one
-- YT-0571 audit: no owner or merchant predicate. Every call site passes a
-- voucher id it already holds on independent authority rather than a fresh
-- client-supplied id: redeem.go's Authorize reads it via FindVoucherByCodeHash
-- (possessing the code IS the credential, see that query's note);
-- settle.go/release.go read it via `authorization.VoucherID`, itself already
-- resolved by a merchant-scoped `ResolveAuthorization` or
-- `GetAuthorizationForOrder`; allocate.go's transition reads it for a
-- voucher id the saga itself is moving. None of these are "look up any
-- voucher by id for a caller who only supplied the id."
SELECT id, listing_id, owner_id, merchant_id, merchant_name, title, face_value_minor,
       remaining_value_minor, partial_redemption_policy, minimum_spend_minor,
       transferable, issued_at, expires_at, location_id, state, void_reason,
       batch_id, version, currency
FROM voucher.vouchers WHERE id = $1;

-- name: TransitionVoucher :one
-- YT-0571 audit: `version = $4` is a concurrency predicate, not an ownership
-- one, and it is not a substitute for one — a stale version and a wrong
-- owner are different failures that happen to look similar. It is safe
-- unscoped for the same reason GetVoucher is: every caller already holds
-- this voucher id on authority established before this query runs, so there
-- is no fresh client-supplied id here to guard against.
--
-- Optimistic concurrency (YT-0142). `version = $4` means a writer working
-- from a stale read matches no row and is told to re-read, rather than
-- overwriting a transition it never saw. Without it, a capture and a
-- kill-switch void racing on one voucher both succeed and the last writer
-- decides whether the money moved.
UPDATE voucher.vouchers
   SET state = $2,
       void_reason = $3,
       remaining_value_minor = $5,
       -- COALESCE, so a transition that is not an allocation leaves the
       -- owner alone. Passing the current owner back in would make every
       -- caller responsible for not accidentally re-owning the voucher.
       owner_id = COALESCE($6, owner_id),
       version = version + 1
 WHERE id = $1 AND version = $4
RETURNING id, state, void_reason, remaining_value_minor, owner_id, version;

-- name: InsertEvent :exec
INSERT INTO voucher.event
  (voucher_id, seq, event_type, detail, prev_hash, hash, occurred_at)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: ListEvents :many
-- Ordered by seq, which is the chain order. The hash of event N commits to
-- N-1, so any other ordering makes verification meaningless.
--
-- ⚠️ YT-0571 audit: unscoped by owner or merchant, and today that is safe
-- ONLY because nothing calls this from an HTTP boundary — its one caller,
-- `VerifyChain`, is an admin/test tool, not a route. docs/09 §10 promises
-- the merchant an audit trail that is "replayable, exportable," and the
-- moment that promise gets a real endpoint, this query returns another
-- merchant's authorize/capture/refund history (amounts, order refs) to
-- whoever supplies the voucher id. Whoever builds that endpoint must join to
-- `voucher.vouchers` for `merchant_id` before this stops being a
-- considered absence and starts being the silent one.
SELECT voucher_id, seq, event_type, detail, prev_hash, hash, occurred_at, created_at
FROM voucher.event WHERE voucher_id = $1 ORDER BY seq;

-- name: LatestEvent :one
-- YT-0571 audit: unscoped, safe today for the same reason as ListEvents —
-- its only caller is `chainHead` (support.go), computing the next event's
-- predecessor during a write this transaction already owns, never answering
-- a fresh external lookup. The same warning applies if that changes.
SELECT voucher_id, seq, event_type, detail, prev_hash, hash, occurred_at, created_at
FROM voucher.event WHERE voucher_id = $1 ORDER BY seq DESC LIMIT 1;

-- name: GetListingTerms :one
-- YT-0571 audit: `id` here is `batch.ListingID` — read from a batch this
-- transaction already fetched via the owner-considered `GetBatch` above,
-- not a fresh client-supplied listing id — so no additional predicate
-- applies.
--
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

-- name: ListExpirableVouchers :many
-- YT-0573: the voucher-level counterpart to `ExpireStaleHolds` in
-- redeem.sql — a different sweep, over a different table, closing a
-- different ticket. `SweepExpiredHolds`/`sweepHolds` only ever touches
-- `voucher.authorization`; nothing before this touched `voucher.vouchers`,
-- so a voucher past its own expiry kept reporting `state = 'active'` to
-- anything reading the table directly — merchant portal, reconciliation,
-- and resale (docs/16 R-2).
--
-- LIMIT bounds one tick's work. A large backlog is worked off over several
-- ticks rather than one long transaction scanning the whole table, the same
-- reasoning `Mint` uses for a single batch rather than the whole of
-- issuance.
SELECT id, version
FROM voucher.vouchers
WHERE state = 'active' AND expires_at <= now()
ORDER BY expires_at
LIMIT $1;
