package proof_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/yourtal/services/ledger/internal/proof"
)

// 10.3.a: "record the proof after day close with a grace period, refusing
// today and future days." A frozen clock, not a real one, so this test
// needs no midnight to actually happen.
// cleanupProof removes a frozen-clock test's own daily_proof row — these
// tests use fixed made-up dates (never a real entry could land there), but
// share one package-level test database across the whole file, so each
// must clean up the exact day it recorded.
func cleanupProof(t *testing.T, day time.Time) {
	t.Helper()
	super := superuser(t)
	t.Cleanup(func() {
		_, _ = super.Exec(context.Background(), `DELETE FROM ledger.daily_proof WHERE proof_date = $1`, day)
	})
}

func TestRecordDailyProofRefusesTodayAndFuture(t *testing.T) {
	checker, _ := newChecker(t, &recordingAlerter{})
	frozen := time.Date(2030, 6, 15, 10, 0, 0, 0, time.UTC)
	checker = checker.WithClock(func() time.Time { return frozen })

	if _, err := checker.RecordDailyProof(context.Background(), frozen); !errors.Is(err, proof.ErrDayNotClosed) {
		t.Errorf("recording today: %v, want ErrDayNotClosed", err)
	}

	future := frozen.AddDate(0, 0, 1)
	if _, err := checker.RecordDailyProof(context.Background(), future); !errors.Is(err, proof.ErrDayNotClosed) {
		t.Errorf("recording a future day: %v, want ErrDayNotClosed", err)
	}

	closed := frozen.AddDate(0, 0, -2)
	cleanupProof(t, time.Date(closed.Year(), closed.Month(), closed.Day(), 0, 0, 0, 0, time.UTC))
	if _, err := checker.RecordDailyProof(context.Background(), closed); err != nil {
		t.Errorf("recording a closed day: %v, want success", err)
	}
}

// GracePeriod's own boundary: yesterday is not closed the instant today
// begins — it closes GracePeriod after today's own midnight, so an entry
// still landing in yesterday's last seconds has a window to arrive.
func TestRecordDailyProofRespectsTheGracePeriod(t *testing.T) {
	checker, _ := newChecker(t, &recordingAlerter{})
	justAfterMidnight := time.Date(2030, 7, 15, 0, 30, 0, 0, time.UTC)
	checker = checker.WithClock(func() time.Time { return justAfterMidnight })

	yesterday := justAfterMidnight.AddDate(0, 0, -1)
	if _, err := checker.RecordDailyProof(context.Background(), yesterday); !errors.Is(err, proof.ErrDayNotClosed) {
		t.Errorf("recording yesterday %v into the grace period: %v, want ErrDayNotClosed", justAfterMidnight, err)
	}

	dayBefore := justAfterMidnight.AddDate(0, 0, -2)
	cleanupProof(t, time.Date(dayBefore.Year(), dayBefore.Month(), dayBefore.Day(), 0, 0, 0, 0, time.UTC))
	if _, err := checker.RecordDailyProof(context.Background(), dayBefore); err != nil {
		t.Errorf("recording the day before yesterday (its own grace period long past): %v, want success", err)
	}
}

func TestRecordDailyProofIfMissingIsIdempotentAcrossTicks(t *testing.T) {
	checker, _ := newChecker(t, &recordingAlerter{})
	day := exclusiveDay(t, superuser(t))

	first, err := checker.RecordDailyProofIfMissing(context.Background(), day)
	if err != nil {
		t.Fatalf("first tick: %v", err)
	}
	second, err := checker.RecordDailyProofIfMissing(context.Background(), day)
	if err != nil {
		t.Fatalf("second tick: %v", err)
	}
	if first != second {
		t.Errorf("two ticks for the same day produced different roots: %s vs %s", first, second)
	}
}
