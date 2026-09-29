-- 10.1: clearing & settlement. Statements are computed once (at generation)
-- from ledger.entry, then stored in ledger.statement so a later dispute or
-- approval reads the same figures however much new activity has posted
-- since.

-- name: MerchantPayableBalanceBefore :one
-- The merchant payable account's natural balance (liability: +SUM) using
-- only entries strictly before asOf — the statement period's opening figure.
SELECT COALESCE(SUM(e.amount_minor), 0)::bigint AS balance_minor
FROM ledger.entry e
WHERE e.account_id = $1 AND e.created_at < sqlc.arg(as_of)::timestamptz;

-- name: MerchantPayableActivityByReason :many
-- Every reason code that touched the merchant's payable account within
-- [from, to), summed. The caller buckets known codes (capture,
-- refund_capture, capture_recovery) and treats anything else as an
-- unrecognised line rather than silently dropping it.
SELECT t.reason_code, SUM(e.amount_minor)::bigint AS subtotal_minor, COUNT(*)::bigint AS entry_count
FROM ledger.entry e
JOIN ledger.transfer t ON t.id = e.transfer_id
WHERE e.account_id = $1 AND e.created_at >= sqlc.arg(from_ts)::timestamptz AND e.created_at < sqlc.arg(to_ts)::timestamptz
GROUP BY t.reason_code;

-- name: PointPurchasesForBusiness :one
-- J1: a business's own point purchases in the period, informational only —
-- never folded into captures_minor/closing_payable_minor above.
SELECT COALESCE(SUM(total_points), 0)::bigint AS points
FROM ledger.allocation
WHERE funder_type = 'business' AND funder_id = $1 AND region = $2
  AND created_at >= sqlc.arg(from_ts)::timestamptz AND created_at < sqlc.arg(to_ts)::timestamptz;

-- name: InsertStatement :one
INSERT INTO ledger.statement (
  id, business_id, region, currency, period_from, period_to,
  opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
  closing_payable_minor, point_purchases_minor, point_purchases_points,
  dispute_window_ends_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
ON CONFLICT (business_id, region, period_from, period_to) DO NOTHING
RETURNING id, business_id, region, currency, period_from, period_to,
  opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
  closing_payable_minor, point_purchases_minor, point_purchases_points,
  status, dispute_reason, disputed_at, resolution_note, resolved_at, dispute_window_ends_at, generated_at,
  approved_by, approved_at, payout_transfer_id;

-- name: GetStatementByPeriod :one
SELECT id, business_id, region, currency, period_from, period_to,
  opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
  closing_payable_minor, point_purchases_minor, point_purchases_points,
  status, dispute_reason, disputed_at, resolution_note, resolved_at, dispute_window_ends_at, generated_at,
  approved_by, approved_at, payout_transfer_id
FROM ledger.statement
WHERE business_id = $1 AND region = $2 AND period_from = $3 AND period_to = $4;

-- name: GetStatement :one
SELECT id, business_id, region, currency, period_from, period_to,
  opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
  closing_payable_minor, point_purchases_minor, point_purchases_points,
  status, dispute_reason, disputed_at, resolution_note, resolved_at, dispute_window_ends_at, generated_at,
  approved_by, approved_at, payout_transfer_id
FROM ledger.statement
WHERE id = $1;

-- name: ListStatementsForBusiness :many
SELECT id, business_id, region, currency, period_from, period_to,
  opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
  closing_payable_minor, point_purchases_minor, point_purchases_points,
  status, dispute_reason, disputed_at, resolution_note, resolved_at, dispute_window_ends_at, generated_at,
  approved_by, approved_at, payout_transfer_id
FROM ledger.statement
WHERE business_id = $1 AND period_from >= sqlc.arg(from_ts)::timestamptz AND period_to <= sqlc.arg(to_ts)::timestamptz
ORDER BY period_from DESC;

-- name: ListOpenStatementsPastDisputeWindow :many
-- The payout worker's own read: everything ready to pay automatically has
-- no place here yet (10.1.c is staff-approved, not automatic) — kept for
-- 10.6.a's queue view instead, listing what is open or disputed regardless
-- of the window, newest first.
SELECT id, business_id, region, currency, period_from, period_to,
  opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
  closing_payable_minor, point_purchases_minor, point_purchases_points,
  status, dispute_reason, disputed_at, resolution_note, resolved_at, dispute_window_ends_at, generated_at,
  approved_by, approved_at, payout_transfer_id
FROM ledger.statement
WHERE status IN ('open', 'disputed') AND region = $1
ORDER BY generated_at ASC;

-- name: MarkStatementDisputed :one
UPDATE ledger.statement
   SET status = 'disputed', dispute_reason = $2, disputed_at = now()
 WHERE id = $1 AND status = 'open'
RETURNING id, business_id, region, currency, period_from, period_to,
  opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
  closing_payable_minor, point_purchases_minor, point_purchases_points,
  status, dispute_reason, disputed_at, resolution_note, resolved_at, dispute_window_ends_at, generated_at,
  approved_by, approved_at, payout_transfer_id;

-- name: MarkStatementResolved :one
-- 10.5.a/10.5.c: staff releases a disputed statement back to open, so it can
-- still be approved once the dispute window allows — the resolution itself
-- (e.g. a K13 recovery line) is posted separately, onto the merchant's
-- current or next statement, not by rewriting this one's own totals.
UPDATE ledger.statement
   SET status = 'open', resolution_note = $2, resolved_at = now()
 WHERE id = $1 AND status = 'disputed'
RETURNING id, business_id, region, currency, period_from, period_to,
  opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
  closing_payable_minor, point_purchases_minor, point_purchases_points,
  status, dispute_reason, disputed_at, resolution_note, resolved_at, dispute_window_ends_at, generated_at,
  approved_by, approved_at, payout_transfer_id;

-- name: MarkStatementApproved :one
UPDATE ledger.statement
   SET status = 'paid', approved_by = $2, approved_at = now(), payout_transfer_id = $3
 WHERE id = $1 AND status = 'open'
RETURNING id, business_id, region, currency, period_from, period_to,
  opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
  closing_payable_minor, point_purchases_minor, point_purchases_points,
  status, dispute_reason, disputed_at, resolution_note, resolved_at, dispute_window_ends_at, generated_at,
  approved_by, approved_at, payout_transfer_id;

-- name: InsertCaptureRecovery :one
INSERT INTO ledger.capture_recovery (id, capture_id, region, merchant_id, amount_minor, currency, reason, transfer_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (capture_id) DO NOTHING
RETURNING id, capture_id, region, merchant_id, amount_minor, currency, reason, transfer_id, created_at;

-- name: GetCaptureRecoveryByCapture :one
SELECT id, capture_id, region, merchant_id, amount_minor, currency, reason, transfer_id, created_at
FROM ledger.capture_recovery
WHERE capture_id = $1;
