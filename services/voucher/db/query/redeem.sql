-- name: InsertAuthorization :one
-- Places the hold. Two unique indexes do the work that no service check
-- could: one live hold per voucher, and one authorization per merchant
-- order. Both surface as unique violations, which the caller maps to
-- distinct refusals — "that voucher is busy" and "you already authorized
-- this order" need different answers at a till.
INSERT INTO voucher.authorization
  (id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref, state, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, 'held', $7)
RETURNING id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref,
          state, expires_at, created_at, resolved_at;

-- name: GetAuthorization :one
SELECT id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref,
       state, expires_at, created_at, resolved_at
FROM voucher.authorization WHERE id = $1;

-- name: GetAuthorizationForOrder :one
-- The replay path: a merchant retrying an authorize for the same order gets
-- back the hold it already has, rather than a duplicate-key error it would
-- have to interpret.
SELECT id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref,
       state, expires_at, created_at, resolved_at
FROM voucher.authorization WHERE merchant_id = $1 AND merchant_order_ref = $2;

-- name: ResolveAuthorization :one
-- `state = 'held' AND expires_at > now()` is the whole expiry policy, applied
-- at the moment of use rather than trusted to a sweeper. A sweeper that
-- stopped running must not silently turn every hold into a permanent one —
-- so an expired hold cannot be captured even while its row still says
-- 'held', and the sweeper's only job is tidying.
UPDATE voucher.authorization
   SET state = $2, resolved_at = now()
 WHERE id = $1 AND state = 'held' AND expires_at > now()
RETURNING id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref,
          state, expires_at, created_at, resolved_at;

-- name: ExpireStaleHolds :many
-- The sweeper. Idempotent by construction: it only matches rows still
-- 'held', so running it twice is a no-op, and not running it changes no
-- decision because every read already filters on expires_at.
UPDATE voucher.authorization
   SET state = 'expired', resolved_at = now()
 WHERE state = 'held' AND expires_at <= now()
RETURNING id, voucher_id;

-- name: InsertCapture :one
-- `authorized_amount_minor` is passed in and constrained by a COMPOSITE
-- foreign key back to the authorization, so a caller cannot inflate it to
-- justify a larger capture. See the migration.
INSERT INTO voucher.capture
  (id, authorization_id, authorized_amount_minor, amount_minor, receipt_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, authorization_id, authorized_amount_minor, amount_minor, receipt_id,
          settled_at, created_at;

-- name: GetCapture :one
SELECT id, authorization_id, authorized_amount_minor, amount_minor, receipt_id,
       settled_at, created_at
FROM voucher.capture WHERE id = $1;

-- name: GetCaptureByReceipt :one
SELECT id, authorization_id, authorized_amount_minor, amount_minor, receipt_id,
       settled_at, created_at
FROM voucher.capture WHERE receipt_id = $1;

-- name: InsertRefund :exec
-- The total is bounded by a deferred constraint trigger, not by this
-- statement: "refunds must not exceed the capture" is a claim about a SET of
-- rows, and a per-row check cannot make it.
INSERT INTO voucher.refund (id, capture_id, amount_minor, reason)
VALUES ($1, $2, $3, $4);

-- name: SumRefunds :one
SELECT COALESCE(SUM(amount_minor), 0)::bigint AS refunded
FROM voucher.refund WHERE capture_id = $1;

-- name: InsertAttempt :exec
-- Every attempt, successful or not. Rows rather than a metric, for the same
-- reason the Reward Engine counts velocity from its grant log: a control
-- enforced against something lossy is not a control, and an evicted counter
-- becomes free attempts for whoever notices first.
INSERT INTO voucher.redemption_attempt (merchant_id, outcome, amount_minor)
VALUES ($1, $2, $3);

-- name: CountFailedAttemptsSince :one
-- docs/09 section 10: "repeated invalid codes from one merchant is THE
-- canonical signal of a compromised key or an enumeration attempt."
SELECT COUNT(*)::bigint AS failures
FROM voucher.redemption_attempt
WHERE merchant_id = $1 AND outcome <> 'authorized' AND occurred_at >= $2;

-- name: IsKilled :one
-- One query for all three scopes. In an incident the question is "is this
-- stopped", and somebody answering it should not have to remember which of
-- three tools covers the case in front of them.
SELECT EXISTS (
  SELECT 1 FROM voucher.kill_switch
   WHERE lifted_at IS NULL
     AND (scope = 'global'
          OR (scope = 'merchant' AND scope_id = $1)
          OR (scope = 'batch'    AND scope_id = $2))
)::boolean AS killed;

-- name: EnableKillSwitch :exec
INSERT INTO voucher.kill_switch (id, scope, scope_id, reason, enabled_by)
VALUES ($1, $2, $3, $4, $5);

-- name: LiftKillSwitch :exec
-- Lifting is recorded as a lift; rows are never deleted, so the timeline of
-- an incident survives the incident.
UPDATE voucher.kill_switch SET lifted_by = $2, lifted_at = now()
 WHERE id = $1 AND lifted_at IS NULL;

-- name: GetActiveCredential :one
SELECT key_id, merchant_id, wrapped_data_key, nonce, ciphertext, key_purpose,
       key_version, state, created_at, not_after, revoked_at
FROM voucher.merchant_credential
WHERE key_id = $1 AND state <> 'revoked'
  AND (not_after IS NULL OR not_after > now());

-- name: InsertCredential :exec
INSERT INTO voucher.merchant_credential
  (key_id, merchant_id, wrapped_data_key, nonce, ciphertext, key_purpose, key_version, state)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'active');

-- name: SupersedeCredential :exec
-- Rotation with overlap: the old key keeps working until `not_after`,
-- because a merchant cannot swap a key atomically across their own fleet and
-- a rotation that took their till offline is one nobody would ever run.
UPDATE voucher.merchant_credential SET state = 'superseded', not_after = $2
 WHERE key_id = $1 AND state = 'active';

-- name: RevokeCredential :exec
-- Revocation is immediate — the half that matters in an incident.
UPDATE voucher.merchant_credential SET state = 'revoked', revoked_at = now()
 WHERE key_id = $1;
