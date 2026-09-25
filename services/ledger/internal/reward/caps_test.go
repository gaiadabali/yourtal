package reward_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
)

// 4.4.f: caps are counted inside the grant's transaction, under a per-user
// lock, on the database's clock (EM-06, EW-11).

// EM-06: a user at 19 of 20 with five concurrent grants on distinct refs
// got 24 grants, because the count ran outside the transaction.
func TestConcurrentGrantsAtTheCapGrantExactlyOne(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	engine = engine.WithCaps(uncapped)
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 2_400*30)
	user := unique("usr")

	for i := range 19 {
		if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionWatchCompleted)); err != nil {
			t.Fatalf("grant %d: %v", i, err)
		}
	}

	var wg sync.WaitGroup
	var ok atomic.Int64
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := engine.Grant(ctx, request(user, allocation, reward.ActionWatchCompleted))
			switch {
			case err == nil:
				ok.Add(1)
			case !errors.Is(err, reward.ErrUserCapReached):
				t.Errorf("a capped grant failed with %v, want ErrUserCapReached", err)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != 1 {
		t.Errorf("%d of 5 concurrent grants at 19/20 succeeded, want exactly 1", ok.Load())
	}
}

// F12: the daily earn cap counts every point a user earns today.
func TestTheDailyEarnCapStopsEarning(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	engine = engine.WithCaps(reward.Caps{DailyPoints: 250, MonthlyPoints: 7_500})
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 10_000)
	user := unique("usr")

	for range 4 { // 4 × 60 = 240
		if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionQuickWatched)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionQuickWatched)); !errors.Is(err, reward.ErrEarnCapReached) {
		t.Fatalf("300 of a 250 daily cap: err = %v, want ErrEarnCapReached", err)
	}
	if b, _ := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending)); b != 240 {
		t.Errorf("pending = %d, want 240", b)
	}
}

func TestTheMonthlyEarnCapStopsEarning(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	engine = engine.WithCaps(reward.Caps{DailyPoints: 10_000, MonthlyPoints: 100})
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 10_000)
	user := unique("usr")

	if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionQuickWatched)); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionQuickWatched)); !errors.Is(err, reward.ErrEarnCapReached) {
		t.Fatalf("120 of a 100 monthly cap: err = %v, want ErrEarnCapReached", err)
	}
}

func TestDefaultCapsAreF12(t *testing.T) {
	au, id := reward.DefaultCaps(ledger.RegionAU), reward.DefaultCaps(ledger.RegionID)
	if au.DailyPoints != 500 || au.MonthlyPoints != 15_000 || id.DailyPoints != 5_000 || id.MonthlyPoints != 150_000 {
		t.Errorf("AU %+v, ID %+v; want 500/15000 and 5000/150000", au, id)
	}
}
