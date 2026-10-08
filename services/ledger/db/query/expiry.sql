-- TASKS.md 10.2: points expiry (F2, off by default) and its 30/7-day
-- warning notices. A new file for the same reason risk.sql is one.

-- name: TouchAccountActivity :exec
-- 10.2.a: last_activity_at moves inside every grant and burn transaction.
UPDATE ledger.account SET last_activity_at = now() WHERE id = $1;

-- name: GetAccountActivity :one
-- Re-read inside the expiry transaction, under LockAccount, so a grant
-- that lands between the listing query and this account's turn is not
-- expired out from under a user who just became active again.
SELECT last_activity_at FROM ledger.account WHERE id = $1;

-- name: ListInactiveUserAccounts :many
-- Candidates for expiry: this region's user "available" accounts untouched
-- since before the cutoff. Balance is checked by the caller (GetAccountBalance)
-- rather than recomputed here, so this query does not duplicate the
-- kind-signed balance arithmetic TrialBalance/GetAccountBalance already own.
-- Keyset-paged on (last_activity_at, id) so zero-balance accounts, which stay
-- inactive forever, cannot crowd later candidates out of a fixed-size page.
SELECT id, owner_id AS user_id, last_activity_at
FROM ledger.account
WHERE owner_type = 'user' AND purpose = 'available' AND country = sqlc.arg(region)
  AND last_activity_at < sqlc.arg(cutoff)::timestamptz
  AND (last_activity_at, id) > (sqlc.arg(after_at)::timestamptz, sqlc.arg(after_id)::text)
ORDER BY last_activity_at, id
LIMIT sqlc.arg(limit_count);

-- name: ListAccountsApproachingExpiry :many
-- Candidates for a 30- or 7-day warning: NOT YET past the region's cutoff
-- (last_activity_at >= cutoff, i.e. still active), but close enough to it
-- that they will cross it within `lead_days` more days
-- (last_activity_at <= cutoff + lead_days). `cutoff` is the same
-- now-minus-inactivityMonths value ListInactiveUserAccounts uses; an
-- account this query returns is one ListInactiveUserAccounts will return
-- `lead_days` from now, if nothing about it changes.
SELECT id, owner_id AS user_id, last_activity_at
FROM ledger.account
WHERE owner_type = 'user' AND purpose = 'available' AND country = sqlc.arg(region)
  AND last_activity_at >= sqlc.arg(cutoff)::timestamptz
  AND last_activity_at <= sqlc.arg(cutoff)::timestamptz + make_interval(days => sqlc.arg(lead_days)::int)
LIMIT sqlc.arg(limit_count);

-- name: InsertPointsExpiryNotice :one
-- ON CONFLICT DO NOTHING: the same (account, milestone, expiring_at) is one
-- notice, however many times the job's tick re-discovers the candidate.
INSERT INTO ledger.points_expiry_notice (account_id, milestone_days, expiring_at)
VALUES (sqlc.arg(account_id), sqlc.arg(milestone_days), sqlc.arg(expiring_at))
ON CONFLICT (account_id, milestone_days, expiring_at) DO NOTHING
RETURNING account_id, milestone_days, expiring_at, created_at;

-- name: ListUnnotifiedPointsExpiry :many
-- Joined to ledger.account so the caller has the user id and region
-- directly, rather than having to parse ledger.UserAccountID's own string
-- shape back apart on the other side of the HTTP boundary.
SELECT n.account_id, n.milestone_days, n.expiring_at, n.created_at,
       a.owner_id AS user_id, a.country AS region
FROM ledger.points_expiry_notice n
JOIN ledger.account a ON a.id = n.account_id
WHERE n.notified_at IS NULL
ORDER BY n.created_at
LIMIT sqlc.arg(limit_count);

-- name: MarkPointsExpiryNotified :exec
UPDATE ledger.points_expiry_notice
SET notified_at = now()
WHERE account_id = sqlc.arg(account_id) AND milestone_days = sqlc.arg(milestone_days)
  AND expiring_at = sqlc.arg(expiring_at);
