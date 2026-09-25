-- name: InsertBackingRate :exec
-- Append-only. A rate is never updated: changing B is a devaluation
-- (docs/09 §6 lever 3) and the history of what it has been must survive the
-- change, or nobody can say what a voucher sold under last month.
-- A proposal: in force only once InsertRateApproval records a second person.
-- No effective_from means "now", on the database's clock.
INSERT INTO ledger.backing_rate
  (id, currency, micros_per_point, issue_price_micros_per_point,
   effective_from, reason, set_by)
VALUES (sqlc.arg(id), sqlc.arg(currency), sqlc.arg(micros_per_point), sqlc.arg(issue_price_micros_per_point),
        COALESCE(sqlc.narg(effective_from)::timestamptz, now()), sqlc.arg(reason), sqlc.arg(set_by));

-- name: InsertRateApproval :one
-- The approval trigger enforces a second person, approval before effect,
-- and 15 minutes' notice for a cut to B.
INSERT INTO ledger.backing_rate_approval (rate_id, approved_by, effective_from)
VALUES ($1, $2, now()) -- the trigger sets the real effective_from
RETURNING effective_from;

-- name: GetBackingRateAt :one
-- The rate in force for a currency at an instant: the latest row effective
-- at or before it. `LIMIT 1` over a DESC index, so a price never depends on
-- how Postgres happened to order two equally-valid rows — and the unique
-- constraint on (currency, effective_from) means there cannot be two.
SELECT r.id, r.currency, r.micros_per_point, r.issue_price_micros_per_point,
       a.effective_from, r.reason, r.set_by, r.created_at
FROM ledger.backing_rate r
JOIN ledger.backing_rate_approval a ON a.rate_id = r.id
WHERE r.currency = $1 AND a.effective_from <= $2
ORDER BY a.effective_from DESC, a.approved_at DESC
LIMIT 1;

-- name: ListBackingRates :many
-- Every rate a currency has ever had, oldest first. This is the devaluation
-- record docs/09 §6 requires be announceable rather than silent.
SELECT r.id, r.currency, r.micros_per_point, r.issue_price_micros_per_point,
       a.effective_from, r.reason, r.set_by, r.created_at
FROM ledger.backing_rate r
JOIN ledger.backing_rate_approval a ON a.rate_id = r.id
WHERE r.currency = $1
ORDER BY a.effective_from;

-- name: SumPointsOutstanding :one
-- Points held by users in one region (available + pending + escrow), which
-- is the platform's points liability. User accounts are credit-normal, so +SUM.
--
-- Summed over USER accounts rather than read off `points_issued`, because
-- marketing grants debit `marketing_expense` instead. Reading one contra account
-- would undercount outstanding points by exactly the promotional issuance —
-- which is the half docs/09 §5 names as the trap, so measuring solvency in
-- a way that cannot see it would be a solvency check that is blind to its
-- own failure mode.
SELECT COALESCE(SUM(e.amount_minor), 0)::bigint AS points
FROM ledger.entry e
JOIN ledger.account a ON a.id = e.account_id
WHERE a.owner_type = 'user' AND a.currency = 'YTP' AND e.currency = 'YTP' AND a.country = $1
  AND a.purpose IN ('available', 'pending', 'escrow');

-- name: GetBackingRateInForce :one
-- The rate in force now, on the database's clock, so no caller can price
-- against an instant of its own choosing.
SELECT r.id, r.currency, r.micros_per_point, r.issue_price_micros_per_point,
       a.effective_from, r.reason, r.set_by, r.created_at
FROM ledger.backing_rate r
JOIN ledger.backing_rate_approval a ON a.rate_id = r.id
WHERE r.currency = $1 AND a.effective_from <= now()
ORDER BY a.effective_from DESC, a.approved_at DESC
LIMIT 1;
