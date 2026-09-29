package heartbeat_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/heartbeat"
	"github.com/yourtal/services/ledger/internal/testdb"
)

func newRecorder(t *testing.T) (*heartbeat.Recorder, *pgxpool.Pool) {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return heartbeat.New(pool), pool
}

func TestATouchedJobIsNeverStale(t *testing.T) {
	r, _ := newRecorder(t)
	ctx := context.Background()
	job := "test-job-" + t.Name()

	if err := r.Touch(ctx, job, time.Minute); err != nil {
		t.Fatalf("Touch: %v", err)
	}
	stale, err := r.Check(ctx)
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	for _, s := range stale {
		if s.JobName == job {
			t.Errorf("a job touched moments ago was reported stale: %+v", s)
		}
	}
}

// A job whose heartbeat is older than twice its own declared interval is
// "hasn't run" — proved by writing a backdated row directly, since a real
// tick cannot be backdated through the Recorder's own API (Touch always
// stamps `now()`).
func TestAJobPastTwiceItsIntervalIsStale(t *testing.T) {
	r, pool := newRecorder(t)
	ctx := context.Background()
	job := "test-job-" + t.Name()

	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger.job_heartbeat (job_name, last_run_at, interval_seconds)
		VALUES ($1, now() - interval '10 minutes', 60)
		ON CONFLICT (job_name) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, interval_seconds = EXCLUDED.interval_seconds
	`, job); err != nil {
		t.Fatalf("seeding a stale heartbeat: %v", err)
	}

	stale, err := r.Check(ctx)
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	found := false
	for _, s := range stale {
		if s.JobName == job {
			found = true
		}
	}
	if !found {
		t.Errorf("stale = %+v, want %s among them (10m old, 60s interval)", stale, job)
	}

	// Touching it again clears the staleness.
	if err := r.Touch(ctx, job, time.Minute); err != nil {
		t.Fatalf("Touch: %v", err)
	}
	stale, err = r.Check(ctx)
	if err != nil {
		t.Fatalf("Check (after touch): %v", err)
	}
	for _, s := range stale {
		if s.JobName == job {
			t.Errorf("a freshly-touched job is still reported stale: %+v", s)
		}
	}
}

func TestSimulatedPagerRaisesARealIncidentRow(t *testing.T) {
	_, pool := newRecorder(t)
	pager := heartbeat.NewSimulatedPager(pool)
	ctx := context.Background()

	if err := pager.Page(ctx, "test summary", "test detail"); err != nil {
		t.Fatalf("Page: %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM ledger.incident WHERE summary = $1 AND detail = $2`,
		"test summary", "test detail").Scan(&count); err != nil {
		t.Fatalf("reading ledger.incident: %v", err)
	}
	if count != 1 {
		t.Errorf("incident rows = %d, want 1", count)
	}
}
