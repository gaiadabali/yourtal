package reward_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/yourtal/services/ledger/internal/reward"
)

// 4.4.e, EM-08: the ledger role held table-wide UPDATE on ledger.allocation,
// so `SET total_points = 1e10, remaining_points = 1e10` funded ten billion
// points behind one purchase. Allocations now move only through the four
// SECURITY DEFINER verbs.
func TestTheLedgerRoleCannotRewriteAnAllocation(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	allocation := fundedAllocation(t, engine, 1_000)
	_, err := pool.Exec(context.Background(),
		`UPDATE ledger.allocation SET total_points = 10000000000, remaining_points = 10000000000 WHERE id = $1`, allocation)
	if err == nil {
		t.Fatal("the ledger role rewrote an allocation to ten billion points")
	}
}

// A session's hold reserves its points, the grant consumes them, and the
// unused rest goes back (4.4.e).
func TestAHoldReservesPointsAndTheGrantConsumesThem(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 3_000)
	hold := unique("hold")

	// Base 2,400 plus a maximum bonus of 400.
	if err := engine.Hold(ctx, reward.HoldRequest{ID: hold, AllocationID: allocation, Points: 2_800, TTL: time.Hour}); err != nil {
		t.Fatal(err)
	}
	if left, _ := engine.RemainingPoints(ctx, allocation); left != 200 {
		t.Fatalf("remaining after the hold = %d, want 200", left)
	}
	// Another session cannot take the held points.
	if err := engine.Hold(ctx, reward.HoldRequest{ID: unique("hold"), AllocationID: allocation, Points: 2_400, TTL: time.Hour}); !errors.Is(err, reward.ErrAllocationExhausted) {
		t.Fatalf("a second session held the first one's points: %v", err)
	}
	req := request(unique("usr"), allocation, reward.ActionWatchCompleted)
	req.HoldID = hold
	if _, err := engine.Grant(ctx, req); err != nil {
		t.Fatalf("the grant on its hold: %v", err)
	}
	// 2,400 used; the 400 bonus nobody earned goes back.
	if left, _ := engine.RemainingPoints(ctx, allocation); left != 600 {
		t.Errorf("remaining after the grant = %d, want 600", left)
	}
}

func TestAnAbandonedHoldIsReleasedOnce(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 1_000)
	hold := unique("hold")
	if err := engine.Hold(ctx, reward.HoldRequest{ID: hold, AllocationID: allocation, Points: 700, TTL: time.Hour}); err != nil {
		t.Fatal(err)
	}
	for i, want := range []bool{true, false} {
		released, err := engine.Release(ctx, hold)
		if err != nil || released != want {
			t.Fatalf("release %d: %v, %v; want %v", i, released, err, want)
		}
	}
	if left, _ := engine.RemainingPoints(ctx, allocation); left != 1_000 {
		t.Errorf("remaining = %d, want 1000", left)
	}
}

func TestAnExpiredHoldIsReleasedByTheSweep(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 1_000)
	if err := engine.Hold(ctx, reward.HoldRequest{ID: unique("hold"), AllocationID: allocation, Points: 700, TTL: time.Second}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1100 * time.Millisecond)
	if released, err := engine.ReleaseExpired(ctx); err != nil || released < 1 {
		t.Fatalf("the sweep released %d: %v", released, err)
	}
	if left, _ := engine.RemainingPoints(ctx, allocation); left != 1_000 {
		t.Errorf("remaining = %d, want 1000", left)
	}
}

func TestAGrantIsReturnedOnce(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 3_000)
	granted, err := engine.Grant(ctx, request(unique("usr"), allocation, reward.ActionWatchCompleted))
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []bool{true, false} {
		returned, err := engine.ReturnGrant(ctx, granted.GrantID)
		if err != nil || returned != want {
			t.Fatalf("return %d: %v, %v; want %v", i, returned, err, want)
		}
	}
	if left, _ := engine.RemainingPoints(ctx, allocation); left != 3_000 {
		t.Errorf("remaining = %d, want 3000", left)
	}
}
