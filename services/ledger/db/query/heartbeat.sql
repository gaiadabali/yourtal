-- 10.3.c: the simulated pager and the "hasn't run" check.

-- name: InsertIncident :exec
INSERT INTO ledger.incident (summary, detail) VALUES ($1, $2);

-- name: TouchHeartbeat :exec
-- Every job's own tick calls this after it runs — insert-or-update, so the
-- first tick after a fresh deploy needs no seed row.
INSERT INTO ledger.job_heartbeat (job_name, last_run_at, interval_seconds)
VALUES ($1, now(), $2)
ON CONFLICT (job_name) DO UPDATE SET last_run_at = now(), interval_seconds = $2;

-- name: ListStaleHeartbeats :many
-- A job whose last tick is more than twice its own interval ago — one
-- missed tick is noise (a slow deploy, a GC pause); two in a row is "hasn't
-- run".
SELECT job_name, last_run_at, interval_seconds
FROM ledger.job_heartbeat
WHERE last_run_at < now() - (interval_seconds * 2 * interval '1 second')
ORDER BY job_name;
