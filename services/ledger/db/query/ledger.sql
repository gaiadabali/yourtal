-- name: InsertTransfer :one
-- Returns nothing on a key that already exists, which is how the caller
-- learns a replay happened without a second round trip or a race.
INSERT INTO ledger.transfer (id, idempotency_key, reason_code, reverses, request_hash)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id, idempotency_key, reason_code, created_at, reverses, request_hash;

-- name: GetTransferByIdempotencyKey :one
SELECT id, idempotency_key, reason_code, created_at, reverses, request_hash
FROM ledger.transfer
WHERE idempotency_key = $1;

-- name: LockAccount :exec
-- Serialises debits of one guarded account for the rest of the transaction;
-- the overdraft trigger takes the same lock at COMMIT.
SELECT pg_advisory_xact_lock(hashtextextended('ledger.account:' || sqlc.arg(account_id)::text, 0));

-- name: InsertEntry :exec
INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency)
VALUES ($1, $2, $3, $4);

-- name: ListEntriesByTransfer :many
SELECT id, transfer_id, account_id, amount_minor, currency, created_at
FROM ledger.entry
WHERE transfer_id = $1
ORDER BY id;

-- name: GetAccount :one
SELECT id, owner_type, owner_id, currency, kind, country, purpose, created_at
FROM ledger.account
WHERE id = $1;

-- name: InsertAccount :exec
-- kind and country are not optional (YT-0043): an account with no
-- classification is one no report can categorise, and the schema refuses it.
INSERT INTO ledger.account (id, owner_type, owner_id, currency, kind, country, purpose)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (id) DO NOTHING;

-- name: GetAccountBalance :one
-- The balance is a PROJECTION, never a stored column (docs/18). It is the
-- NATURAL balance: entries are credit-positive, so asset and expense
-- accounts read as -SUM and everything else as +SUM. No row: no account.
SELECT (CASE WHEN a.kind IN ('asset', 'expense') THEN -1 ELSE 1 END
        * COALESCE(SUM(e.amount_minor), 0))::bigint AS balance_minor
FROM ledger.account a
LEFT JOIN ledger.entry e ON e.account_id = a.id AND e.currency = a.currency
WHERE a.id = $1
GROUP BY a.kind;

-- name: TrialBalance :many
-- Credits minus debits per kind and currency for one region. Double entry
-- makes the raw sums total zero; the natural balances then satisfy
-- assets + expenses = liabilities + equity + revenue.
SELECT a.kind, a.currency, COALESCE(SUM(e.amount_minor), 0)::bigint AS credit_minus_debit
FROM ledger.account a
LEFT JOIN ledger.entry e ON e.account_id = a.id AND e.currency = a.currency
WHERE a.country = $1
GROUP BY a.kind, a.currency
ORDER BY a.currency, a.kind;

-- name: FindImbalancedTransfers :many
-- The invariant checker. Should always return nothing; if it ever does not,
-- the deferred trigger has been bypassed or dropped and that is a P1.
-- Summed as numeric and returned as text, so a tamper that overflows bigint
-- is reported with its true sum rather than failing the query (EM-23).
SELECT transfer_id, SUM(amount_minor)::text AS imbalance
FROM ledger.entry
GROUP BY transfer_id
HAVING SUM(amount_minor) <> 0;

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
