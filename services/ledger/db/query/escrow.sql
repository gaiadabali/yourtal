-- name: InsertEscrow :exec
INSERT INTO ledger.escrow (id, idempotency_key, user_id, region, points, available_points, pending_points, reason, transfer_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: GetEscrow :one
SELECT e.id, e.idempotency_key, e.user_id, e.region, e.points, e.available_points, e.pending_points,
       e.reason, e.created_at, r.created_at AS released_at
FROM ledger.escrow e
LEFT JOIN ledger.escrow_release r ON r.escrow_id = e.id
WHERE e.id = $1;

-- name: GetEscrowByIdempotencyKey :one
SELECT id FROM ledger.escrow WHERE idempotency_key = $1;

-- name: InsertEscrowRelease :execrows
INSERT INTO ledger.escrow_release (escrow_id, transfer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: UserHasHeldEscrow :one
-- 4.4.g: while any escrow is held, the user's holdback releases wait.
SELECT EXISTS (
  SELECT 1 FROM ledger.escrow e
  LEFT JOIN ledger.escrow_release r ON r.escrow_id = e.id
  WHERE e.user_id = $1 AND r.escrow_id IS NULL
) AS held;
