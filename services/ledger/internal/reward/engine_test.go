package reward_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// YT-0045, against the real Postgres from `pnpm dev:up`.
//
// The assertion that matters most is the K6 one: you cannot issue a point
// without a funded allocation behind it. It is enforced by a single UPDATE
// whose WHERE clause fails to match when the allocation is short — so the
// only way to know it holds is to run it, concurrently, against Postgres.

var counter atomic.Uint64

// unique needs the counter for the same reason the ledger tests do: a
// timestamp alone collides across goroutines on a coarse clock, and the
// resulting duplicate keys make a concurrency test measure deduplication
// instead of concurrency.
func unique(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), counter.Add(1))
}

// uncapped lifts the F12 earn caps for tests whose subject is something else.
var uncapped = reward.Caps{DailyPoints: 1 << 40, MonthlyPoints: 1 << 40}

type refuseAll struct{}

func (refuseAll) Allow(context.Context, string, reward.ActionType) (bool, error) {
	return false, nil
}

func newEngine(t *testing.T, gate reward.RiskGate) (*reward.Engine, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("no local Postgres (run `pnpm dev:up`): %v", err)
	}
	t.Cleanup(pool.Close)

	engine := reward.New(pool, ledger.New(pool), gate, "ID")
	if err := engine.EnsureChart(ctx); err != nil {
		t.Fatalf("ensure chart: %v", err)
	}
	withF1Rates(t, pool)
	return engine, pool
}

// withF1Rates puts the decided rates in force (F1): ID B = IDR 6, P_issue =
// IDR 9; AU B = 3¢, P_issue = 4.5¢.
func withF1Rates(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	rates := pricing.New(pool)
	for currency, r := range map[string][2]int64{"IDR": {6_000_000, 9_000_000}, "AUD": {3_000_000, 4_500_000}} {
		id := unique("rate")
		if err := rates.ProposeRate(context.Background(), pricing.Rate{
			ID: id, Currency: currency, MicrosPerPoint: r[0], IssuePriceMicrosPerPoint: r[1],
			Reason: "F1 test fixture", SetBy: "reward_test",
		}); err != nil {
			t.Fatalf("rate %s: %v", currency, err)
		}
		if _, err := rates.ApproveRate(context.Background(), id, "reward_approver"); err != nil {
			t.Fatalf("approving %s: %v", currency, err)
		}
	}
}

// fundedAllocation is a partner allocation the only way one exists (K6): a
// purchase, in whole 1,000-point packs at the ID issue price of IDR 9.
func fundedAllocation(t *testing.T, engine *reward.Engine, points int64) string {
	t.Helper()
	packs := (points + 999) / 1_000
	result, err := engine.RecordPurchase(context.Background(), reward.PurchaseRequest{
		ID: unique("pur"), PartnerID: "adv_1", Points: packs * 1_000, AmountMinor: packs * 9_000, Currency: "IDR",
	})
	if err != nil {
		t.Fatalf("purchase: %v", err)
	}
	return result.AllocationID
}

// fundedMarketing is a marketing budget with IDR cash behind it, for the
// marketing-funded actions (streaks, referrals).
func fundedMarketing(t *testing.T, engine *reward.Engine, points int64) string {
	t.Helper()
	if _, err := engine.FundMarketing(context.Background(), unique("fund"), points*6+1_000, "alice", "bob"); err != nil {
		t.Fatalf("fund marketing: %v", err)
	}
	id := unique("alloc_mkt")
	if err := engine.CreateAllocation(context.Background(), id, "marketing", "growth", points); err != nil {
		t.Fatalf("marketing allocation: %v", err)
	}
	return id
}

func request(userID, allocationID string, action reward.ActionType) reward.GrantRequest {
	req := reward.GrantRequest{
		UserID:       userID,
		Action:       action,
		ExternalRef:  unique("ref"),
		Evidence:     "checkpoint-token",
		AllocationID: allocationID,
	}
	// A watch has no taxonomy price (4.4.a); these tests pay a fixed 2,400.
	if action == reward.ActionWatchCompleted {
		req = reward.WithPoints(req, 2_400)
	}
	return req
}

func TestGrantCreditsTheUserAndDrawsDownTheAllocation(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	allocation := fundedAllocation(t, engine, 10_000)
	user := unique("usr")

	result, err := engine.Grant(ctx, request(user, allocation, reward.ActionWatchCompleted))
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	if result.Points != 2_400 {
		t.Errorf("paid %d, want the taxonomy's 2400", result.Points)
	}

	balance, err := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending))
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 2_400 {
		t.Errorf("user balance = %d, want 2400", balance)
	}

	remaining, err := engine.RemainingPoints(ctx, allocation)
	if err != nil {
		t.Fatalf("remaining: %v", err)
	}
	if remaining != 7_600 {
		t.Errorf("allocation remaining = %d, want 7600", remaining)
	}
}

// docs/16 K6: no unfunded points, ever. This is the single failure mode the
// rule exists to prevent.
func TestCannotIssueBeyondTheAllocation(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	// Enough for exactly one completion.
	allocation := fundedAllocation(t, engine, 2_400)
	user := unique("usr")

	if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionWatchCompleted)); err != nil {
		t.Fatalf("first grant: %v", err)
	}

	_, err := engine.Grant(ctx, request(user, allocation, reward.ActionWatchCompleted))
	if !errors.Is(err, reward.ErrAllocationExhausted) {
		t.Fatalf("second grant err = %v, want ErrAllocationExhausted", err)
	}

	// And nothing was credited for the refused attempt.
	balance, err := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending))
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 2_400 {
		t.Errorf("balance = %d, want 2400 — an unfunded point was issued", balance)
	}
}

// The concurrent version, which is the one a read-then-write would fail.
func TestConcurrentGrantsCannotOverdrawAnAllocation(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	engine = engine.WithCaps(uncapped)
	ctx := context.Background()

	// Exactly four completions' worth, with twelve callers racing for them.
	const completions = 4
	allocation := fundedAllocation(t, engine, 2_400*completions)
	user := unique("usr")

	var wg sync.WaitGroup
	var granted atomic.Int64

	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionWatchCompleted)); err == nil {
				granted.Add(1)
			}
		}()
	}
	wg.Wait()

	if granted.Load() != completions {
		t.Errorf("%d grants succeeded, want exactly %d", granted.Load(), completions)
	}

	remaining, err := engine.RemainingPoints(ctx, allocation)
	if err != nil {
		t.Fatalf("remaining: %v", err)
	}
	if remaining != 10_000-2_400*completions {
		t.Errorf("allocation remaining = %d, want %d", remaining, 10_000-2_400*completions)
	}

	balance, err := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending))
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if want := int64(2_400 * completions); balance != want {
		t.Errorf("balance = %d, want %d — points were issued without funding", balance, want)
	}
}

func TestVelocityCapIsEnforcedBeforeTheLedger(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	// A streak is capped at one per user per day.
	allocation := fundedMarketing(t, engine, 100_000)
	user := unique("usr")

	first := request(user, allocation, reward.ActionDailyStreak)
	first.Evidence = ""
	if _, err := engine.Grant(ctx, first); err != nil {
		t.Fatalf("first streak: %v", err)
	}

	second := request(user, allocation, reward.ActionDailyStreak)
	second.Evidence = ""
	if _, err := engine.Grant(ctx, second); !errors.Is(err, reward.ErrUserCapReached) {
		t.Fatalf("second streak err = %v, want ErrUserCapReached", err)
	}

	// "Before the ledger" is the part worth asserting: a cap that refuses
	// after posting would leave the credit in place and the refusal in a log.
	balance, err := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending))
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 500 {
		t.Errorf("balance = %d, want 500 — the capped grant still credited", balance)
	}

	remaining, err := engine.RemainingPoints(ctx, allocation)
	if err != nil {
		t.Fatalf("remaining: %v", err)
	}
	if remaining != 100_000-500 {
		t.Error("the capped grant still drew down the allocation")
	}
}

func TestTheSameActionCannotBePaidTwice(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	allocation := fundedAllocation(t, engine, 100_000)
	user := unique("usr")

	req := request(user, allocation, reward.ActionWatchCompleted)
	if _, err := engine.Grant(ctx, req); err != nil {
		t.Fatalf("first: %v", err)
	}

	// Same external ref — the same real-world watch session, re-submitted.
	_, err := engine.Grant(ctx, req)
	if err == nil {
		t.Fatal("the same action was paid twice")
	}
}

func TestRefusalsLeaveNoTrace(t *testing.T) {
	ctx := context.Background()
	allocationPoints := int64(100_000)

	cases := []struct {
		name    string
		mutate  func(*reward.GrantRequest)
		gate    reward.RiskGate
		wantErr error
	}{
		{
			name:    "unknown action",
			mutate:  func(r *reward.GrantRequest) { r.Action = "mint_me_points" },
			gate:    reward.AlwaysAllow{},
			wantErr: reward.ErrUnknownAction,
		},
		{
			name:    "missing evidence",
			mutate:  func(r *reward.GrantRequest) { r.Evidence = "" },
			gate:    reward.AlwaysAllow{},
			wantErr: reward.ErrEvidenceMissing,
		},
		{
			name:    "risk gate refuses",
			mutate:  func(*reward.GrantRequest) {},
			gate:    refuseAll{},
			wantErr: reward.ErrRiskRefused,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			engine, pool := newEngine(t, tc.gate)
			allocation := fundedAllocation(t, engine, allocationPoints)
			user := unique("usr")

			req := request(user, allocation, reward.ActionWatchCompleted)
			tc.mutate(&req)

			if _, err := engine.Grant(ctx, req); !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}

			// A refusal must not move money or funding. Anything that got as
			// far as drawing down would be funding destroyed for nothing.
			balance, err := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending))
			if err != nil {
				t.Fatalf("balance: %v", err)
			}
			if balance != 0 {
				t.Errorf("a refused grant credited %d", balance)
			}

			remaining, err := engine.RemainingPoints(ctx, allocation)
			if err != nil {
				t.Fatalf("remaining: %v", err)
			}
			if remaining != allocationPoints {
				t.Errorf("a refused grant drew down %d", allocationPoints-remaining)
			}
		})
	}
}

// docs/18 §9: the engine "gets smarter only in its INPUTS, never in its
// arithmetic". Two users doing the same thing are paid the same.
func TestTheTaxonomyPricesEveryoneIdentically(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	allocation := fundedAllocation(t, engine, 100_000)
	alice, bob := unique("usr_a"), unique("usr_b")

	for _, user := range []string{alice, bob} {
		if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionWatchCompleted)); err != nil {
			t.Fatalf("grant for %s: %v", user, err)
		}
	}

	book := ledger.New(pool)
	aliceBalance, _ := book.Balance(ctx, ledger.UserAccountID(alice, ledger.PurposePending))
	bobBalance, _ := book.Balance(ctx, ledger.UserAccountID(bob, ledger.PurposePending))

	if aliceBalance != bobBalance {
		t.Errorf("same action paid %d and %d", aliceBalance, bobBalance)
	}
}

// Marketing-funded grants must stay visible as marketing spend afterwards —
// the whole reason the chart has a separate contra account.
func TestMarketingGrantsPostToTheMarketingAccount(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	book := ledger.New(pool)
	expense := ledger.PlatformAccountID(ledger.RegionID, ledger.RoleMarketingExpense)
	before, err := book.Balance(ctx, expense)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}

	allocation := fundedMarketing(t, engine, 100_000)
	req := request(unique("usr"), allocation, reward.ActionDailyStreak)
	req.Evidence = ""
	if _, err := engine.Grant(ctx, req); err != nil {
		t.Fatalf("grant: %v", err)
	}

	after, err := book.Balance(ctx, expense)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	// An expense is debit-normal: its natural balance grows with the spend.
	if after != before+500 {
		t.Errorf("marketing expense moved by %d, want +500", after-before)
	}
}

func TestEveryTaxonomyEntryIsUsable(t *testing.T) {
	// A definition with no points, or a cap of zero, is an action that can
	// never pay — which would be a silent dead end rather than an error.
	for _, action := range reward.AllActions() {
		definition, found := reward.Definition(action)
		if !found {
			t.Fatalf("%s is listed but has no definition", action)
		}
		// A watch is priced by its campaign's terms (4.4.a), never here.
		if action != reward.ActionWatchCompleted && definition.Points <= 0 {
			t.Errorf("%s pays %d", action, definition.Points)
		}
		if definition.MaxPerUserPerDay <= 0 {
			t.Errorf("%s is capped at %d per day, so it can never pay",
				action, definition.MaxPerUserPerDay)
		}
	}
}
