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

// 4.4.k: the caps are the approved F12 settings, read per region.
func TestCapsComeFromTheRegionSettings(t *testing.T) {
	idEngine, pool := newEngine(t, reward.AlwaysAllow{})
	auEngine := reward.New(pool, ledger.New(pool), reward.AlwaysAllow{}, ledger.RegionAU)
	au, err := auEngine.Caps(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	id, err := idEngine.Caps(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if au.DailyPoints != 500 || au.MonthlyPoints != 15_000 || id.DailyPoints != 5_000 || id.MonthlyPoints != 150_000 {
		t.Errorf("AU %+v, ID %+v; want 500/15000 and 5000/150000", au, id)
	}
	// 12.1.c: teens get half the daily cap — seeded explicitly by
	// 20260925193000_platform_region_setting.sql, not derived here.
	if au.TeenDailyPoints != 250 || id.TeenDailyPoints != 2_500 {
		t.Errorf("AU teen daily %d, ID teen daily %d; want 250 and 2500", au.TeenDailyPoints, id.TeenDailyPoints)
	}
}

// 12.1.c: the pure 30x-or-floor arithmetic behind a teen's monthly ceiling,
// checked directly (see export_test.go's EffectiveCaps for why a live grant
// sequence cannot isolate this from the daily check).
func TestEffectiveCapsForATeen(t *testing.T) {
	cases := []struct {
		name          string
		caps          reward.Caps
		wantDaily     int64
		wantMonthly   int64
		monthlyBranch string
	}{
		{
			name:          "the 30x-teen-daily branch binds",
			caps:          reward.Caps{DailyPoints: 500, TeenDailyPoints: 250, MonthlyPoints: 1_000_000},
			wantDaily:     250,
			wantMonthly:   7_500, // 30 x 250, comfortably under the huge adult monthly cap
			monthlyBranch: "30x",
		},
		{
			name:          "the adult monthly cap floors it",
			caps:          reward.Caps{DailyPoints: 500, TeenDailyPoints: 250, MonthlyPoints: 3_000},
			wantDaily:     250,
			wantMonthly:   3_000, // 30 x 250 = 7,500 would be MORE generous than an adult's own 3,000
			monthlyBranch: "floor",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			daily, monthly := reward.EffectiveCaps(tc.caps, reward.AgeBandTeen)
			if daily != tc.wantDaily || monthly != tc.wantMonthly {
				t.Errorf("(%s) = %d/%d, want %d/%d", tc.monthlyBranch, daily, monthly, tc.wantDaily, tc.wantMonthly)
			}
		})
	}
}

// An adult (or an unrecognised/empty AgeBand — the API layer is what
// refuses those; this package's own arithmetic is total) gets the region's
// caps completely unchanged, never the teen halving.
func TestEffectiveCapsForAnAdultIsUnchanged(t *testing.T) {
	caps := reward.Caps{DailyPoints: 500, TeenDailyPoints: 250, MonthlyPoints: 15_000}
	for _, band := range []reward.AgeBand{reward.AgeBandAdult, ""} {
		daily, monthly := reward.EffectiveCaps(caps, band)
		if daily != caps.DailyPoints || monthly != caps.MonthlyPoints {
			t.Errorf("ageBand %q: %d/%d, want the adult caps %d/%d unchanged", band, daily, monthly, caps.DailyPoints, caps.MonthlyPoints)
		}
	}
}

// F12/12.1.c, live: a teen is capped at HALF the adult daily cap (AU's real
// 500/250 pair), and the SAME grant that refuses a teen still succeeds for
// an adult — the Check this task must pass ("a teen's grant above the cap
// is refused"), proved against the real engine and a real Postgres balance,
// not just the arithmetic above.
func TestATeensGrantAboveTheTeenDailyCapIsRefused(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	engine = engine.WithCaps(reward.Caps{DailyPoints: 500, TeenDailyPoints: 250, MonthlyPoints: 15_000})
	ctx := context.Background()
	book := ledger.New(pool)

	teen := unique("usr_teen")
	teenAllocation := fundedAllocation(t, engine, 10_000)
	for i := range 4 { // 4 x 60 = 240, under the 250 teen cap
		req := request(teen, teenAllocation, reward.ActionQuickWatched)
		req.AgeBand = reward.AgeBandTeen
		if _, err := engine.Grant(ctx, req); err != nil {
			t.Fatalf("teen grant %d: %v", i, err)
		}
	}
	over := request(teen, teenAllocation, reward.ActionQuickWatched)
	over.AgeBand = reward.AgeBandTeen
	if _, err := engine.Grant(ctx, over); !errors.Is(err, reward.ErrEarnCapReached) {
		t.Fatalf("300 of a 250 teen daily cap: err = %v, want ErrEarnCapReached", err)
	}
	if b, _ := book.Balance(ctx, ledger.UserAccountID(teen, ledger.PurposePending)); b != 240 {
		t.Errorf("teen pending = %d, want 240 — the refused grant left a trace", b)
	}
	// No new grant/transfer row for the refused attempt: the allocation is
	// exactly what 4 grants of 60 drew down, no more.
	remaining, err := engine.RemainingPoints(ctx, teenAllocation)
	if err != nil {
		t.Fatal(err)
	}
	if remaining != 10_000-240 {
		t.Errorf("teen allocation remaining = %d, want %d — a refused grant still drew funding", remaining, 10_000-240)
	}

	// The identical 5th grant (300 total) succeeds for an ADULT: comfortably
	// under the SAME region's 500 adult daily cap.
	adult := unique("usr_adult")
	adultAllocation := fundedAllocation(t, engine, 10_000)
	for i := range 5 { // 5 x 60 = 300
		req := request(adult, adultAllocation, reward.ActionQuickWatched)
		if _, err := engine.Grant(ctx, req); err != nil {
			t.Fatalf("adult grant %d: %v", i, err)
		}
	}
	if b, _ := book.Balance(ctx, ledger.UserAccountID(adult, ledger.PurposePending)); b != 300 {
		t.Errorf("adult pending = %d, want 300", b)
	}
}

// F12/12.1.c: the ID pair (5,000 adult / 2,500 teen) behaves the same way as
// AU's, at its own boundary.
func TestATeensGrantAboveTheTeenDailyCapIsRefusedInID(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	engine = engine.WithCaps(reward.Caps{DailyPoints: 5_000, TeenDailyPoints: 2_500, MonthlyPoints: 150_000})
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 100_000)
	user := unique("usr")

	for i := range 41 { // 41 x 60 = 2,460, under the 2,500 teen cap
		req := request(user, allocation, reward.ActionQuickWatched)
		req.AgeBand = reward.AgeBandTeen
		if _, err := engine.Grant(ctx, req); err != nil {
			t.Fatalf("grant %d: %v", i, err)
		}
	}
	over := request(user, allocation, reward.ActionQuickWatched)
	over.AgeBand = reward.AgeBandTeen
	if _, err := engine.Grant(ctx, over); !errors.Is(err, reward.ErrEarnCapReached) {
		t.Fatalf("2,520 of a 2,500 teen daily cap: err = %v, want ErrEarnCapReached", err)
	}
	if b, _ := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending)); b != 2_460 {
		t.Errorf("pending = %d, want 2460 — the refused grant left a trace", b)
	}
}

// 12.1.c's month rule, live: a teen's monthly ceiling is 30x their OWN daily
// cap, floored by the adult monthly cap — exercised here via the floor
// branch (the 30x branch is TestEffectiveCapsForATeen's, above; see that
// test's header for why a live sequence can only ever show the floor).
func TestATeensMonthlyCapCanBeTheAdultFloor(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	// TeenDailyPoints high enough to never bind in this test; MonthlyPoints
	// deliberately BELOW 30 x TeenDailyPoints, so effectiveCaps' min() picks
	// the adult monthly cap, not the teen's own 30x multiple.
	engine = engine.WithCaps(reward.Caps{DailyPoints: 100_000, TeenDailyPoints: 10_000, MonthlyPoints: 3_000})
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 10_000)
	user := unique("usr")

	first := reward.WithPoints(request(user, allocation, reward.ActionWatchCompleted), 2_400)
	first.AgeBand = reward.AgeBandTeen
	if _, err := engine.Grant(ctx, first); err != nil {
		t.Fatalf("first: %v", err)
	}
	second := reward.WithPoints(request(user, allocation, reward.ActionWatchCompleted), 2_400)
	second.AgeBand = reward.AgeBandTeen
	if _, err := engine.Grant(ctx, second); !errors.Is(err, reward.ErrEarnCapReached) {
		t.Fatalf("4,800 of a 3,000 (floored) teen monthly cap: err = %v, want ErrEarnCapReached", err)
	}
}
