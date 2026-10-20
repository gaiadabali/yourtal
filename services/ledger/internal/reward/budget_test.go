package reward_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/yourtal/services/ledger/internal/reward"
)

// 14.2: a campaign's budget and daily cap, counted with its live session holds.

func holdFor(t *testing.T, engine *reward.Engine, c liveCampaign, points int64) (string, error) {
	t.Helper()
	id := unique("hold")
	return id, engine.HoldForCampaign(context.Background(),
		reward.HoldRequest{ID: id, AllocationID: c.Allocation, Points: points, TTL: time.Hour}, c.ID)
}

func setDailyCap(t *testing.T, c liveCampaign, cap int64) {
	t.Helper()
	if _, err := ownerPool(t).Exec(context.Background(),
		`UPDATE campaign.reward_config SET daily_cap_points = $2 WHERE campaign_id = $1`, c.ID, cap); err != nil {
		t.Fatal(err)
	}
}

// Live holds count as spent, so the session admitted last is paid in full and
// the next one starts non-earning instead of being refused at the end.
func TestSessionHoldsReserveTheCampaignBudget(t *testing.T) {
	engine, _ := rewardEngine(t)
	ctx := context.Background()
	campaign := newLiveCampaign(t, engine, 100, 0, 250)

	first, err := holdFor(t, engine, campaign, 100)
	if err != nil {
		t.Fatal(err)
	}
	second, err := holdFor(t, engine, campaign, 100)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := holdFor(t, engine, campaign, 100); !errors.Is(err, reward.ErrOverCampaignMax) {
		t.Fatalf("a third session on 200 held of 250: %v", err)
	}
	// A grant without a hold cannot take the room the two sessions hold.
	if _, err := engine.GrantReward(ctx, campaign.reward(freshUser(), 100, 0, 0, 3)); !errors.Is(err, reward.ErrOverCampaignMax) {
		t.Fatalf("an unheld grant took held room: %v", err)
	}
	// Each held session is paid at the end.
	for i, hold := range []string{first, second} {
		req := campaign.reward(freshUser(), 100, 0, 0, 3)
		req.HoldID = hold
		if _, err := engine.GrantReward(ctx, req); err != nil {
			t.Fatalf("session %d on its own hold: %v", i, err)
		}
	}
	if _, err := holdFor(t, engine, campaign, 100); !errors.Is(err, reward.ErrOverCampaignMax) {
		t.Fatalf("a session after the budget was spent: %v", err)
	}
}

// An abandoned session gives its room back to the budget.
func TestAReleasedHoldFreesTheBudget(t *testing.T) {
	engine, _ := rewardEngine(t)
	ctx := context.Background()
	campaign := newLiveCampaign(t, engine, 100, 0, 100)
	hold, err := holdFor(t, engine, campaign, 100)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := holdFor(t, engine, campaign, 100); !errors.Is(err, reward.ErrOverCampaignMax) {
		t.Fatalf("the budget was held: %v", err)
	}
	if released, err := engine.Release(ctx, hold); err != nil || !released {
		t.Fatalf("the hold was not released: %v", err)
	}
	if _, err := holdFor(t, engine, campaign, 100); err != nil {
		t.Fatalf("after the release: %v", err)
	}
}

// The daily cap stops sessions for the rest of the day, and paid grants keep
// counting toward it; the total budget is untouched.
func TestTheDailyCapStopsSessionsForTheRestOfTheDay(t *testing.T) {
	engine, _ := rewardEngine(t)
	ctx := context.Background()
	campaign := newLiveCampaign(t, engine, 100, 0, 1_000_000)
	setDailyCap(t, campaign, 200)

	hold, err := holdFor(t, engine, campaign, 100)
	if err != nil {
		t.Fatal(err)
	}
	req := campaign.reward(freshUser(), 100, 0, 0, 3)
	req.HoldID = hold
	if _, err := engine.GrantReward(ctx, req); err != nil {
		t.Fatal(err)
	}
	if _, err := holdFor(t, engine, campaign, 100); err != nil {
		t.Fatalf("100 granted of a 200 cap: %v", err)
	}
	if _, err := holdFor(t, engine, campaign, 100); !errors.Is(err, reward.ErrCampaignDailyCap) {
		t.Fatalf("100 granted and 100 held of a 200 cap: %v", err)
	}
	budgets, err := engine.CampaignBudgets(ctx, []string{campaign.ID})
	if err != nil || len(budgets) != 1 {
		t.Fatalf("budgets: %v %v", budgets, err)
	}
	if got := budgets[0]; got.RemainingTodayPoints == nil || *got.RemainingTodayPoints != 0 || got.RemainingPoints != 1_000_000-200 {
		t.Fatalf("budget = %+v, want 0 today and %d in all", got, 1_000_000-200)
	}
}

// Race-safety: many sessions starting at once never reserve more than the
// budget, and exactly as many as fit are admitted.
func TestConcurrentSessionsNeverOverbookTheBudget(t *testing.T) {
	engine, pool := rewardEngine(t)
	campaign := newLiveCampaign(t, engine, 100, 0, 1_000)
	const sessions = 25
	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		admitted int
	)
	for range sessions {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := holdFor(t, engine, campaign, 100)
			switch {
			case err == nil:
				mu.Lock()
				admitted++
				mu.Unlock()
			case !errors.Is(err, reward.ErrOverCampaignMax):
				t.Errorf("a session failed for another reason: %v", err)
			}
		}()
	}
	wg.Wait()
	if admitted != 10 {
		t.Fatalf("admitted %d sessions of 100 into a budget of 1,000, want 10", admitted)
	}
	var held int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(h.points), 0) FROM ledger.campaign_hold c
		JOIN ledger.allocation_hold h ON h.id = c.hold_id
		WHERE c.campaign_id = $1 AND h.state = 'held'`, campaign.ID).Scan(&held); err != nil {
		t.Fatal(err)
	}
	if held != 1_000 {
		t.Fatalf("held %d, want exactly the budget of 1,000", held)
	}
}

// A hold names its campaign's own allocation, never another.
func TestACampaignHoldOnAnotherAllocationIsRefused(t *testing.T) {
	engine, _ := rewardEngine(t)
	campaign := newLiveCampaign(t, engine, 100, 0, 1_000)
	campaign.Allocation = fundedAllocation(t, engine, 1_000)
	if _, err := holdFor(t, engine, campaign, 100); !errors.Is(err, reward.ErrWrongFunder) {
		t.Fatalf("a hold on another allocation: %v", err)
	}
}

// A replayed hold is admitted without counting itself twice.
func TestAReplayedCampaignHoldCountsOnce(t *testing.T) {
	engine, _ := rewardEngine(t)
	ctx := context.Background()
	campaign := newLiveCampaign(t, engine, 100, 0, 100)
	req := reward.HoldRequest{ID: unique("hold"), AllocationID: campaign.Allocation, Points: 100, TTL: time.Hour}
	for i := range 2 {
		if err := engine.HoldForCampaign(ctx, req, campaign.ID); err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
}
