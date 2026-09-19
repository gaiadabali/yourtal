-- name: InsertTransfer :one
-- Returns nothing on a key that already exists, which is how the caller
-- learns a replay happened without a second round trip or a race.
INSERT INTO ledger.transfer (id, idempotency_key, reason_code)
VALUES ($1, $2, $3)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id, idempotency_key, reason_code, created_at;

-- name: GetTransferByIdempotencyKey :one
SELECT id, idempotency_key, reason_code, created_at
FROM ledger.transfer
WHERE idempotency_key = $1;

-- name: InsertEntry :exec
INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency)
VALUES ($1, $2, $3, $4);

-- name: ListEntriesByTransfer :many
SELECT id, transfer_id, account_id, amount_minor, currency, created_at
FROM ledger.entry
WHERE transfer_id = $1
ORDER BY id;

-- name: GetAccount :one
SELECT id, owner_type, owner_id, currency, kind, country, created_at
FROM ledger.account
WHERE id = $1;

-- name: InsertAccount :exec
-- kind and country are not optional (YT-0043): an account with no
-- classification is one no report can categorise, and the schema refuses it.
INSERT INTO ledger.account (id, owner_type, owner_id, currency, kind, country)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (id) DO NOTHING;

-- name: GetAccountBalance :one
-- The balance is a PROJECTION, never a stored column. A stored balance is a
-- second source of truth that can disagree with the entries, and when it
-- does the entries are right and the balance is the bug (docs/18).
SELECT COALESCE(SUM(amount_minor), 0)::bigint AS balance_minor
FROM ledger.entry
WHERE account_id = $1;

-- name: FindImbalancedTransfers :many
-- The invariant checker. Should always return nothing; if it ever does not,
-- the deferred trigger has been bypassed or dropped and that is a P1.
SELECT transfer_id, COALESCE(SUM(amount_minor), 0)::bigint AS imbalance
FROM ledger.entry
GROUP BY transfer_id
HAVING COALESCE(SUM(amount_minor), 0) <> 0;

-- name: InsertAllocation :exec
INSERT INTO ledger.allocation
  (id, funder_type, funder_id, currency, total_points, remaining_points)
VALUES ($1, $2, $3, 'YTP', $4, $4);

-- name: DrawDownAllocation :one
-- The K6 gate. `WHERE remaining_points >= $2` means an exhausted allocation
-- matches NO ROW rather than going negative — so "cannot issue an unfunded
-- point" is a property of this one statement, not of the caller checking
-- first. A read-then-write would let two concurrent grants both see enough
-- and both draw, which is exactly how unfunded points get minted.
UPDATE ledger.allocation
   SET remaining_points = remaining_points - $2
 WHERE id = $1 AND remaining_points >= $2
RETURNING id, funder_type, funder_id, currency, total_points, remaining_points, created_at;

-- name: GetAllocation :one
SELECT id, funder_type, funder_id, currency, total_points, remaining_points, created_at
FROM ledger.allocation WHERE id = $1;

-- name: InsertGrant :exec
INSERT INTO ledger.grant
  (id, user_id, action_type, taxonomy_ver, points, allocation_id, transfer_id,
   device_id, ip_address, external_ref)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: CountGrantsForUserSince :one
SELECT COUNT(*)::bigint AS grants, COALESCE(SUM(points), 0)::bigint AS points
FROM ledger.grant
WHERE user_id = $1 AND action_type = $2 AND created_at >= $3;

-- name: CountGrantsForDeviceSince :one
SELECT COUNT(*)::bigint AS grants
FROM ledger.grant
WHERE device_id = $1 AND created_at >= $2;

-- name: CountGrantsForIpSince :one
SELECT COUNT(*)::bigint AS grants
FROM ledger.grant
WHERE ip_address = $1 AND created_at >= $2;

-- name: InsertPointPurchase :exec
INSERT INTO ledger.point_purchase
  (id, partner_id, points, amount_minor, currency, allocation_id, cash_transfer_id)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: GetPointPurchase :one
SELECT id, partner_id, points, amount_minor, currency, allocation_id,
       cash_transfer_id, created_at
FROM ledger.point_purchase WHERE id = $1;

-- name: ListPurchasesForPartner :many
-- The audit trail: both facts of every purchase, with the allocation and the
-- reserve posting they produced. This is also where `B` becomes derivable
-- from history once YT-0506 resolves — because both sides are recorded, not
-- one plus a rate.
SELECT id, partner_id, points, amount_minor, currency, allocation_id,
       cash_transfer_id, created_at
FROM ledger.point_purchase WHERE partner_id = $1 ORDER BY created_at;

-- name: ListEntriesForDay :many
-- Ordered by id, which is the bigserial insertion order. The Merkle root is
-- only meaningful if the leaf order is deterministic, and id is the one
-- ordering that cannot tie or drift — created_at can collide at the same
-- microsecond and would make the root depend on how Postgres broke the tie.
SELECT id, transfer_id, account_id, amount_minor, currency, created_at
FROM ledger.entry
WHERE created_at >= $1 AND created_at < $2
ORDER BY id;

-- name: InsertDailyProof :exec
INSERT INTO ledger.daily_proof
  (proof_date, merkle_root, entry_count, first_entry_id, last_entry_id)
VALUES ($1, $2, $3, $4, $5);

-- name: GetDailyProof :one
SELECT proof_date, merkle_root, entry_count, first_entry_id, last_entry_id, computed_at
FROM ledger.daily_proof WHERE proof_date = $1;

-- name: ListDailyProofs :many
SELECT proof_date, merkle_root, entry_count, first_entry_id, last_entry_id, computed_at
FROM ledger.daily_proof ORDER BY proof_date;
