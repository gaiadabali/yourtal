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
  (id, funder_type, funder_id, currency, total_points, remaining_points, region)
VALUES ($1, $2, $3, 'YTP', $4, $4, $5);

-- The four allocation verbs (4.4.e). The ledger role has no UPDATE on
-- ledger.allocation; these SECURITY DEFINER functions are the only way its
-- remaining_points moves, and an exhausted allocation is a `false`, never a
-- negative balance (K6).

-- name: HoldAllocation :one
SELECT ledger.allocation_hold(sqlc.arg(hold_id)::text, sqlc.arg(allocation_id)::text,
  sqlc.arg(points)::bigint, sqlc.arg(ttl_seconds)::bigint)::boolean AS held;

-- name: ConsumeHold :one
-- The allocation id, or '' when the hold is no longer live.
SELECT COALESCE(ledger.allocation_consume(sqlc.arg(hold_id)::text, sqlc.arg(points)::bigint), '')::text AS allocation_id;

-- name: ReleaseHold :one
SELECT ledger.allocation_release(sqlc.arg(hold_id)::text)::boolean AS released;

-- name: ReleaseExpiredHolds :one
SELECT ledger.allocation_release_expired()::integer AS released;

-- name: ReturnGrant :one
SELECT ledger.allocation_return(sqlc.arg(grant_id)::text)::boolean AS returned;

-- name: GetAllocation :one
SELECT id, funder_type, funder_id, currency, total_points, remaining_points, created_at
FROM ledger.allocation WHERE id = $1;

-- name: InsertGrant :one
-- unlock_at is the database's now() plus the tier's holdback (4.4.g).
INSERT INTO ledger.grant
  (id, user_id, action_type, taxonomy_ver, points, allocation_id, transfer_id,
   device_id, ip_address, external_ref, campaign_id, region, unlock_at, idempotency_key,
   session_id, terms_version, asked, correct)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(action_type), sqlc.arg(taxonomy_ver), sqlc.arg(points),
        sqlc.arg(allocation_id), sqlc.arg(transfer_id), sqlc.narg(device_id), sqlc.narg(ip_address),
        sqlc.arg(external_ref), sqlc.narg(campaign_id), sqlc.narg(region),
        -- NULL holdback: no unlock time, the grant waits in pending (legacy callers).
        now() + make_interval(hours => sqlc.narg(holdback_hours)::int), sqlc.narg(idempotency_key),
        sqlc.narg(session_id), sqlc.narg(terms_version)::int, sqlc.narg(asked)::int, sqlc.narg(correct)::int)
RETURNING created_at, unlock_at;

-- Velocity counts run inside the grant's transaction on the database's
-- clock; a caller-supplied time let a future `now` skip every cap (EM-06).

-- name: LockUserGrants :exec
-- One grant decision per user at a time, so a count and the grant it
-- allows cannot interleave with another grant's (EW-11).
SELECT pg_advisory_xact_lock(hashtextextended('ledger.grant:' || sqlc.arg(user_id)::text, 0));

-- name: CountRecentGrantsForUser :one
SELECT COUNT(*)::bigint AS grants
FROM ledger.grant
WHERE user_id = $1 AND action_type = $2 AND created_at >= now() - interval '24 hours';

-- name: CountRecentGrantsForDevice :one
SELECT COUNT(*)::bigint AS grants
FROM ledger.grant
WHERE device_id = $1 AND created_at >= now() - interval '24 hours';

-- name: CountRecentGrantsForIp :one
SELECT COUNT(*)::bigint AS grants
FROM ledger.grant
WHERE ip_address = $1 AND created_at >= now() - interval '24 hours';

-- name: SumPointsEarnedThisPeriod :one
-- Points granted since the start of the current day or month on the
-- region's clock (F16): `period` is 'day' or 'month', `tz` an IANA zone.
SELECT COALESCE(SUM(points), 0)::bigint AS points
FROM ledger.grant
WHERE user_id = sqlc.arg(user_id)
  AND created_at >= (date_trunc(sqlc.arg(period)::text, now() AT TIME ZONE sqlc.arg(tz)::text)
                     AT TIME ZONE sqlc.arg(tz)::text);

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

-- name: LockUserGrantsSession :exec
-- The session-level twin of LockUserGrants, taken before the grant's
-- transaction begins; see reward.Engine.issue.
SELECT pg_advisory_lock(hashtextextended('ledger.grant:' || sqlc.arg(user_id)::text, 0));

-- name: UnlockUserGrantsSession :exec
SELECT pg_advisory_unlock(hashtextextended('ledger.grant:' || sqlc.arg(user_id)::text, 0));

-- name: InsertMarketingFunding :exec
-- K6: the only record that lets marketing cash increase (the trigger in
-- 20260925195000 checks for it at COMMIT). Two different people, by CHECK.
INSERT INTO ledger.marketing_funding (id, region, amount_minor, proposed_by, approved_by, transfer_id)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: InsertBurn :exec
INSERT INTO ledger.burn (saga_id, user_id, region, points, settlement_minor, points_transfer_id, liability_transfer_id, listing_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: GetBurn :one
SELECT b.saga_id, b.user_id, b.region, b.points, b.settlement_minor, b.created_at,
       r.created_at AS reinstated_at, b.listing_id
FROM ledger.burn b
LEFT JOIN ledger.burn_reinstatement r ON r.saga_id = b.saga_id
WHERE b.saga_id = $1;

-- name: InsertBurnReinstatement :exec
INSERT INTO ledger.burn_reinstatement (saga_id, points_transfer_id, liability_transfer_id, reason)
VALUES ($1, $2, $3, $4);

-- name: GetAllocationWithRegion :one
SELECT id, funder_type, funder_id, region, total_points, remaining_points, created_at
FROM ledger.allocation WHERE id = $1;

-- name: ListAllocationsForFunder :many
SELECT id, funder_type, funder_id, region, total_points, remaining_points, created_at
FROM ledger.allocation WHERE funder_id = $1 ORDER BY created_at;

-- name: GetHold :one
SELECT id, allocation_id, points, state, expires_at FROM ledger.allocation_hold WHERE id = $1;

-- name: GetGrant :one
SELECT id, user_id, action_type, points, campaign_id, region, created_at, unlock_at
FROM ledger.grant WHERE id = $1;

-- name: GetGrantByExternalRef :one
SELECT id, user_id, action_type, points, campaign_id, region, created_at, unlock_at, idempotency_key
FROM ledger.grant WHERE user_id = $1 AND action_type = $2 AND external_ref = $3;

-- name: ListUnlockedGrants :many
-- 4.4.g: grants whose holdback has passed and that are not yet released.
SELECT g.id, g.user_id, g.points
FROM ledger.grant g
LEFT JOIN ledger.grant_release r ON r.grant_id = g.id
WHERE g.unlock_at IS NOT NULL AND g.unlock_at <= now() AND r.grant_id IS NULL
ORDER BY g.unlock_at
LIMIT $1;

-- name: InsertGrantRelease :execrows
INSERT INTO ledger.grant_release (grant_id, transfer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: PendingBuckets :many
-- A user's held-back points, one bucket per unlock time still ahead.
SELECT g.unlock_at, SUM(g.points)::bigint AS points
FROM ledger.grant g
LEFT JOIN ledger.grant_release r ON r.grant_id = g.id
WHERE g.user_id = $1 AND g.unlock_at IS NOT NULL AND r.grant_id IS NULL
GROUP BY g.unlock_at
ORDER BY g.unlock_at;

-- name: CampaignSpend :one
SELECT COUNT(*)::bigint AS completions, COALESCE(SUM(points), 0)::bigint AS granted_points
FROM ledger.grant WHERE campaign_id = $1;

-- name: UserHistory :many
-- Newest first: grants, burns and reinstatements. `before_at`/`before_id` is
-- the cursor of the last entry already seen; NULL starts at the newest.
WITH entries AS (
  SELECT g.id, 'grant'::text AS kind, g.points, g.external_ref, g.campaign_id, NULL::uuid AS listing_id, g.created_at AS at
    FROM ledger.grant g WHERE g.user_id = sqlc.arg(user_id)
  UNION ALL
  SELECT 'burn_' || b.saga_id, 'burn', b.points, b.saga_id, NULL::uuid, b.listing_id, b.created_at
    FROM ledger.burn b WHERE b.user_id = sqlc.arg(user_id)
  UNION ALL
  SELECT 'reinstatement_' || r.saga_id, 'reinstatement', b.points, r.saga_id, NULL::uuid, b.listing_id, r.created_at
    FROM ledger.burn_reinstatement r JOIN ledger.burn b ON b.saga_id = r.saga_id WHERE b.user_id = sqlc.arg(user_id)
)
SELECT id, kind, points, external_ref, campaign_id, listing_id, at FROM entries
WHERE sqlc.narg(before_at)::timestamptz IS NULL
   OR (at, id) < (sqlc.narg(before_at)::timestamptz, sqlc.narg(before_id)::text)
ORDER BY at DESC, id DESC
LIMIT sqlc.arg(max_rows);

-- name: InsertQuote :one
INSERT INTO ledger.quote (id, region, currency, settlement_minor, price_points, backing_rate_id, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, now() + interval '15 minutes')
RETURNING id, region, currency, settlement_minor, price_points, backing_rate_id, created_at, expires_at;

-- name: GetQuote :one
SELECT q.id, q.region, q.currency, q.settlement_minor, q.price_points, q.backing_rate_id,
       q.created_at, q.expires_at, (l.quote_id IS NOT NULL)::boolean AS locked, (q.expires_at <= now())::boolean AS expired
FROM ledger.quote q LEFT JOIN ledger.quote_lock l ON l.quote_id = q.id WHERE q.id = $1;

-- name: LockQuote :exec
INSERT INTO ledger.quote_lock (quote_id) VALUES ($1) ON CONFLICT DO NOTHING;

-- name: UpsertListingPrice :one
INSERT INTO ledger.listing_price (listing_id, region, currency, settlement_minor, price_points, backing_rate_id, computed_at)
VALUES ($1, $2, $3, $4, $5, $6, now())
ON CONFLICT (listing_id) DO UPDATE
  SET settlement_minor = EXCLUDED.settlement_minor, price_points = EXCLUDED.price_points,
      backing_rate_id = EXCLUDED.backing_rate_id, computed_at = now()
  WHERE ledger.listing_price.region = EXCLUDED.region
RETURNING listing_id, region, currency, settlement_minor, price_points, backing_rate_id, computed_at;

-- name: GetListingPrice :one
SELECT listing_id, region, currency, settlement_minor, price_points, backing_rate_id, computed_at
FROM ledger.listing_price WHERE listing_id = $1;

-- name: GetRewardConfig :one
-- Which allocation pays a campaign, and the most one completion may earn.
SELECT campaign_id, allocation_id, funder_type, max_points_for_campaign,
       reward_points_per_completion, accuracy_bonus_points
FROM campaign.reward_config WHERE campaign_id = $1;

-- name: GetRateProposal :one
SELECT r.id, r.currency, r.micros_per_point, r.issue_price_micros_per_point, r.set_by,
       a.approved_by
FROM ledger.backing_rate r LEFT JOIN ledger.backing_rate_approval a ON a.rate_id = r.id WHERE r.id = $1;

-- name: EconomyDaily :many
-- Per region-clock day: points granted, points burned, and the reserve's
-- natural balance at the end of the day (an asset, so -SUM).
WITH days AS (
  SELECT d::date AS day
  FROM generate_series(sqlc.arg(from_day)::date, sqlc.arg(to_day)::date, interval '1 day') AS d
)
SELECT days.day::date AS day,
  (SELECT COALESCE(SUM(g.points), 0) FROM ledger.grant g
    WHERE g.region = sqlc.arg(region)::text AND (g.created_at AT TIME ZONE sqlc.arg(tz)::text)::date = days.day)::bigint AS points_issued,
  (SELECT COALESCE(SUM(b.points), 0) FROM ledger.burn b
    WHERE b.region = sqlc.arg(region)::text AND (b.created_at AT TIME ZONE sqlc.arg(tz)::text)::date = days.day)::bigint AS points_redeemed,
  (SELECT -COALESCE(SUM(e.amount_minor), 0) FROM ledger.entry e
    WHERE e.account_id = sqlc.arg(reserve_account)::text
      AND (e.created_at AT TIME ZONE sqlc.arg(tz)::text)::date <= days.day)::bigint AS reserve_minor
FROM days
ORDER BY days.day;

-- name: GetCampaignOwner :one
SELECT id, business_id, region, state FROM campaign.campaign_owner WHERE id = $1;

-- name: GetCampaignTerms :one
SELECT campaign_id, version, reward_points, question_count, scoring_rule, accuracy_bonus_points
FROM campaign.campaign_terms WHERE campaign_id = $1 AND version = $2;

-- name: LockCampaignGrants :exec
-- Serialises grants on one campaign, so its maximum is checked and spent
-- by one grant at a time.
SELECT pg_advisory_xact_lock(hashtextextended('ledger.campaign:' || sqlc.arg(campaign_id)::text, 0));

-- name: ListStaleListingPrices :many
-- 4.9.a: listings priced at a rate that is no longer the one in force now.
SELECT lp.listing_id, lp.currency, lp.settlement_minor, lp.backing_rate_id
FROM ledger.listing_price lp
JOIN LATERAL (
  SELECT r.id FROM ledger.backing_rate r
  JOIN ledger.backing_rate_approval a ON a.rate_id = r.id
  WHERE r.currency = lp.currency AND a.effective_from <= now()
  ORDER BY a.effective_from DESC, a.approved_at DESC
  LIMIT 1
) cur ON true
WHERE cur.id <> lp.backing_rate_id
ORDER BY lp.listing_id
LIMIT $1;

-- name: RepriceListing :execrows
-- Only if S and the rate are still what was read, so a concurrent
-- priceListing is never overwritten with a stale S.
UPDATE ledger.listing_price
SET price_points = sqlc.arg(price_points), backing_rate_id = sqlc.arg(rate_id), computed_at = now()
WHERE listing_id = sqlc.arg(listing_id) AND settlement_minor = sqlc.arg(settlement_minor)
  AND backing_rate_id = sqlc.arg(priced_rate_id);
