// Package heartbeat is 10.3.c: "alerts go through a simulated pager, with a
// 'hasn't run' check for every scheduled job." Every scheduled loop in this
// service (cmd/ledger/main.go) touches its own named row after each tick;
// Check compares each row's age against its own declared interval and pages
// the ones that have gone quiet.
package heartbeat

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Recorder touches one named job's heartbeat after each successful tick.
type Recorder struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Recorder {
	return &Recorder{pool: pool}
}

// Touch records that jobName just ran, and how often it is expected to —
// the interval travels with every touch (not just the first) so changing a
// job's schedule in code takes effect on its very next tick, not only for a
// job that has never run before.
func (r *Recorder) Touch(ctx context.Context, jobName string, interval time.Duration) error {
	if err := sqlcgen.New(r.pool).TouchHeartbeat(ctx, sqlcgen.TouchHeartbeatParams{
		JobName: jobName, IntervalSeconds: int64(interval.Seconds()),
	}); err != nil {
		return fmt.Errorf("heartbeat: touching %s: %w", jobName, err)
	}
	return nil
}

// Stale is one job whose last heartbeat is older than twice its own
// interval allows — one missed tick is noise (a slow deploy, a GC pause);
// two in a row is "hasn't run".
type Stale struct {
	JobName   string
	LastRunAt time.Time
	Interval  time.Duration
}

// Check answers every job that has gone quiet.
func (r *Recorder) Check(ctx context.Context) ([]Stale, error) {
	rows, err := sqlcgen.New(r.pool).ListStaleHeartbeats(ctx)
	if err != nil {
		return nil, fmt.Errorf("heartbeat: listing stale jobs: %w", err)
	}
	stale := make([]Stale, 0, len(rows))
	for _, row := range rows {
		stale = append(stale, Stale{
			JobName: row.JobName, LastRunAt: row.LastRunAt.Time,
			Interval: time.Duration(row.IntervalSeconds) * time.Second,
		})
	}
	return stale, nil
}

// SimulatedPager is 10.3.c's "simulated pager" (CLAUDE.md: everything
// external is a simulated driver): every page is a real row in
// ledger.incident, queryable and durable, not only a log line — see
// proof.LoggingAlerter's own comment for why a pager that "merely logs" is
// not the real thing.
type SimulatedPager struct {
	pool *pgxpool.Pool
}

func NewSimulatedPager(pool *pgxpool.Pool) SimulatedPager {
	return SimulatedPager{pool: pool}
}

// Page satisfies proof.Alerter (and any other caller that just needs
// "raise an incident, summary and detail").
func (p SimulatedPager) Page(ctx context.Context, summary, detail string) error {
	if err := sqlcgen.New(p.pool).InsertIncident(ctx, sqlcgen.InsertIncidentParams{
		Summary: summary, Detail: detail,
	}); err != nil {
		return fmt.Errorf("heartbeat: raising incident: %w", err)
	}
	return nil
}
