-- TASKS.md 10.4: the real RiskGate's own signal queries and its manual-review
-- queue (10.4.b/10.5). A new file rather than an addition to ledger.sql --
-- shared hotspot rule, and this domain has no reason to touch caps/grant
-- queries that A's own work also reads.

-- name: CountGrantsForUserSince :one
-- Velocity: how many grants (any action) this user has had inside the
-- window, regardless of the daily/monthly cap accounting in caps.go, which
-- counts POINTS per calendar day, not events per rolling minute.
SELECT COUNT(*)::bigint AS grants
FROM ledger.grant
WHERE user_id = $1 AND created_at >= sqlc.arg(since)::timestamptz;

-- name: CountDistinctUsersForDeviceSince :one
-- Impossible flow: how many OTHER identities this device has been granted
-- under inside the window -- one device claiming to be several different
-- people in a few minutes is account/device farming, not a shared kiosk.
SELECT COUNT(DISTINCT user_id)::bigint AS other_users
FROM ledger.grant
WHERE device_id = sqlc.arg(device_id) AND user_id <> sqlc.arg(user_id)
  AND created_at >= sqlc.arg(since)::timestamptz;

-- name: CountDistinctUsersForIpSince :one
SELECT COUNT(DISTINCT user_id)::bigint AS other_users
FROM ledger.grant
WHERE ip_address = sqlc.arg(ip_address) AND user_id <> sqlc.arg(user_id)
  AND created_at >= sqlc.arg(since)::timestamptz;

-- name: InsertRiskFlag :one
INSERT INTO ledger.risk_flag (id, user_id, region, severity, reason, signals, escrow_id)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(region), sqlc.arg(severity),
        sqlc.arg(reason), sqlc.arg(signals), sqlc.narg(escrow_id))
RETURNING id, created_at;

-- name: GetRiskFlag :one
SELECT id, user_id, region, severity, reason, signals, escrow_id, status,
       created_at, resolved_at, resolved_by, resolution_note
FROM ledger.risk_flag WHERE id = $1;

-- name: ListRiskQueue :many
-- Pending flags for one region, newest first -- 10.5.a's own screen.
SELECT id, user_id, region, severity, reason, signals, escrow_id, status,
       created_at, resolved_at, resolved_by, resolution_note
FROM ledger.risk_flag
WHERE region = sqlc.arg(region) AND status = 'pending'
ORDER BY created_at DESC
LIMIT sqlc.arg(limit_count);

-- name: ResolveRiskFlag :one
-- Only a PENDING flag resolves; a second resolve attempt matches no row,
-- which the caller reads as "already handled" rather than double-acting.
UPDATE ledger.risk_flag
SET status = sqlc.arg(status), resolved_at = now(), resolved_by = sqlc.arg(resolved_by),
    resolution_note = sqlc.narg(resolution_note),
    escrow_id = COALESCE(sqlc.narg(escrow_id), escrow_id)
WHERE id = sqlc.arg(id) AND status = 'pending'
RETURNING id, user_id, region, severity, reason, signals, escrow_id, status,
          created_at, resolved_at, resolved_by, resolution_note;
