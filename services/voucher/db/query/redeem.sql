-- name: InsertAuthorization :one
-- Places the hold. Two unique indexes do the work that no service check
-- could: one live hold per voucher, and one authorization per merchant
-- order. Both surface as unique violations, which the caller maps to
-- distinct refusals — "that voucher is busy" and "you already authorized
-- this order" need different answers at a till.
INSERT INTO voucher.authorization
  (id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref, state, expires_at,
   order_total_minor)
VALUES ($1, $2, $3, $4, $5, $6, 'held', $7, $8)
RETURNING id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref,
          state, expires_at, created_at, resolved_at, order_total_minor;

-- name: GetAuthorization :one
-- YT-0571 audit: no merchant predicate, by consideration rather than by
-- omission. Both call sites resolve a client-supplied id against merchant
-- ownership without this query's help — ownership.go's
-- requireOwnedAuthorization fetches by id and compares merchant_id itself,
-- which IS the boundary check this ticket says stays; release.go's Refund
-- calls this with an authorization id it already reached through a
-- capture that captureForReceipt resolved under a merchant predicate
-- (GetCaptureByReceipt, below). Scoping this query too would need a
-- merchant_id neither call site is wrong to be missing — the boundary
-- check already does the comparison it exists to do, and the other caller
-- never had an unscoped id in the first place.
SELECT id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref,
       state, expires_at, created_at, resolved_at, order_total_minor
FROM voucher.authorization WHERE id = $1;

-- name: GetAuthorizationForOrder :one
-- The replay path: a merchant retrying an authorize for the same order gets
-- back the hold it already has, rather than a duplicate-key error it would
-- have to interpret.
SELECT id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref,
       state, expires_at, created_at, resolved_at, order_total_minor
FROM voucher.authorization WHERE merchant_id = $1 AND merchant_order_ref = $2;

-- name: ResolveAuthorization :one
-- `state = 'held' AND expires_at > now()` is the whole expiry policy, applied
-- at the moment of use rather than trusted to a sweeper. A sweeper that
-- stopped running must not silently turn every hold into a permanent one —
-- so an expired hold cannot be captured even while its row still says
-- 'held', and the sweeper's only job is tidying.
--
-- ⚠️ YT-0571: `merchant_id = $3` is the fix, not a hardening. Capture and
-- Void resolve a CLIENT-SUPPLIED authorization id, and this query used to
-- carry no merchant predicate at all — correct for the invariant the
-- domain tests assert (an id is only ever handed back to the merchant that
-- placed the hold), wrong the moment an HTTP client can supply the id.
-- ownership.go's requireOwnedAuthorization is a boundary check and stays;
-- this is the WHERE clause that makes the data safe on its own, for
-- whatever calls this query next without going through that boundary. A
-- wrong merchant and a wrong id now fail identically — both are
-- `pgx.ErrNoRows`, mapped by the caller to the same ErrNoLiveHold — so this
-- does not create a new distinguishable refusal.
UPDATE voucher.authorization
   SET state = $2, resolved_at = now()
 WHERE id = $1 AND merchant_id = $3 AND state = 'held' AND expires_at > now()
RETURNING id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref,
          state, expires_at, created_at, resolved_at, order_total_minor;

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
-- YT-0571 audit: no merchant predicate, considered rather than silent. The
-- only caller is Refund (release.go), and its capture id is never
-- client-supplied — a merchant's refund call carries a receipt_id, resolved
-- to this capture's id by captureForReceipt under a merchant predicate
-- (GetCaptureByReceipt, below) before Refund ever runs. By the time this id
-- reaches here it has already passed a scoped lookup once.
SELECT id, authorization_id, authorized_amount_minor, amount_minor, receipt_id,
       settled_at, created_at
FROM voucher.capture WHERE id = $1;

-- name: GetCaptureByReceipt :one
-- ⚠️ YT-0571: `merchant_id = $2` closes the same hole as ResolveAuthorization,
-- for the same reason — "refund-by-receipt has the same shape as capture."
-- `voucher.capture` carries no merchant_id of its own, so this joins back to
-- the authorization that owns it rather than trusting captureForReceipt's
-- own boundary check (which stays) to be the only thing standing between a
-- stranger's receipt_id guess and somebody else's settled transaction. A
-- receipt from another merchant, real or guessed, now matches no row —
-- the same `pgx.ErrNoRows` an unknown receipt already produced.
SELECT c.id, c.authorization_id, c.authorized_amount_minor, c.amount_minor, c.receipt_id,
       c.settled_at, c.created_at
FROM voucher.capture c
JOIN voucher.authorization a ON a.id = c.authorization_id
WHERE c.receipt_id = $1 AND a.merchant_id = $2;

-- name: InsertRefund :execrows
-- The total is bounded by a deferred constraint trigger, not by this
-- statement: "refunds must not exceed the capture" is a claim about a SET of
-- rows, and a per-row check cannot make it.
INSERT INTO voucher.refund (id, capture_id, amount_minor, reason, refund_ref)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (capture_id, refund_ref) DO NOTHING;

-- name: GetRefundByRef :one
SELECT id, capture_id, amount_minor, reason, created_at, refund_ref
FROM voucher.refund WHERE capture_id = $1 AND refund_ref = $2;

-- name: SumRefunds :one
-- YT-0571 audit: not called from any Go code yet — no caller to audit. When
-- wired, capture_id must arrive the same way Refund's does: resolved from a
-- receipt through GetCaptureByReceipt's merchant predicate, never accepted
-- bare from a request body.
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
--
-- `currency_mismatch` is excluded alongside `authorized`: it means the code
-- was real, belonged to this merchant, and was otherwise redeemable — the
-- caller just sent the wrong currency on the request. That is a client-side
-- integration bug, not a signal of a compromised key or an enumeration
-- attempt, so counting it toward the throttle would rate-limit a merchant
-- whose integration has a bug rather than one who is probing codes.
--
-- Only PROBES count (D13): a code that does not exist or is not this
-- merchant's. A real voucher refused on its own rules (minimum spend, value,
-- state) is an honest till, and a killed or throttled attempt counted here
-- kept a till throttled for as long as it retried.
SELECT COUNT(*)::bigint AS failures
FROM voucher.redemption_attempt
WHERE merchant_id = $1 AND outcome IN ('unknown_code', 'wrong_merchant')
  AND occurred_at >= $2;

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

-- name: RememberSignature :execrows
-- 1 the first time a signature is seen, 0 on a replay (D9).
INSERT INTO voucher.merchant_signature_seen (key_id, mac) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: PruneSeenSignatures :execrows
-- Older than twice the replay window: those can never verify again.
DELETE FROM voucher.merchant_signature_seen WHERE seen_at < now() - interval '10 minutes';
