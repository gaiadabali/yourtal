-- name: ClaimIdempotencyKey :one
-- YT-0039's insert half. `ON CONFLICT DO NOTHING` makes the claim atomic
-- under concurrency: two requests racing on the same (scope, key) can only
-- ever have one of them get a row back from this statement. The other gets
-- zero rows and falls through to GetIdempotency to learn why it lost the
-- race — a different fingerprint, an in-flight duplicate, or a replay.
INSERT INTO platform.idempotency (scope, key, fingerprint, state, expires_at)
VALUES ($1, $2, $3, 'in_progress', $4)
ON CONFLICT (scope, key) DO NOTHING
RETURNING scope, key, fingerprint, state, status, body, started_at, expires_at;

-- name: GetIdempotency :one
SELECT scope, key, fingerprint, state, status, body, started_at, expires_at
FROM platform.idempotency
WHERE scope = $1 AND key = $2;

-- name: CompleteIdempotency :exec
-- Only ever moves 'in_progress' -> 'completed', the same shape as a capture
-- only ever resolving a 'held' authorization: a row that has already
-- finished must not be overwritten by a second, unrelated finish.
UPDATE platform.idempotency
   SET state = 'completed', status = $3, body = $4
 WHERE scope = $1 AND key = $2 AND state = 'in_progress';
