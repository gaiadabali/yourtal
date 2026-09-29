package expiry_test

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/escrow"
	"github.com/yourtal/services/ledger/internal/expiry"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// TASKS.md 10.2.c: "with expiry off, nothing expires. With it on for a test
// region, an account clock-shifted 12 months posts breakage once, and an
// escrowed account does not."
//
// The seeded default (1.2.f) is off for both AU and ID, so this suite
// proposes/approves its OWN points_expiry setting for whichever region a
// test needs on — never edits the seeded row, same propose-then-approve
// shape the staff console itself uses (region_setting_approval_rules
// refuses an edit to an already-approved row).

var counter atomic.Uint64

func unique(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), counter.Add(1))
}

func setup(t *testing.T) (*pgxpool.Pool, *reward.Engine, *escrow.Engine) {
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

	book := ledger.New(pool)
	engine := reward.New(pool, book, reward.AlwaysAllow{}, ledger.RegionID).WithCaps(reward.Caps{
		DailyPoints: 1 << 40, MonthlyPoints: 1 << 40,
	})
	if err := engine.EnsureChart(ctx); err != nil {
		t.Fatalf("ensure chart: %v", err)
	}
	rates := pricing.New(pool)
	rateID := unique("rate")
	if err := rates.ProposeRate(ctx, pricing.Rate{
		ID: rateID, Currency: "IDR", MicrosPerPoint: 6_000_000, IssuePriceMicrosPerPoint: 9_000_000,
		Reason: "expiry test fixture", SetBy: "expiry_test",
	}); err != nil {
		t.Fatalf("propose rate: %v", err)
	}
	if _, err := rates.ApproveRate(ctx, rateID, "expiry_test_approver"); err != nil {
		t.Fatalf("approve rate: %v", err)
	}
	return pool, engine, escrow.New(pool, book)
}

func fundedAllocation(t *testing.T, engine *reward.Engine, points int64) string {
	t.Helper()
	packs := (points + 999) / 1_000
	result, err := engine.RecordPurchase(context.Background(), reward.PurchaseRequest{
		ID: unique("pur"), PartnerID: "adv_expiry", Points: packs * 1_000, AmountMinor: packs * 9_000, Currency: "IDR",
	})
	if err != nil {
		t.Fatalf("purchase: %v", err)
	}
	return result.AllocationID
}

func grantAndClockShift(t *testing.T, pool *pgxpool.Pool, engine *reward.Engine, allocation string, monthsAgo int) string {
	t.Helper()
	ctx := context.Background()
	user := unique("usr")
	var noHoldback int32 // 0: released to available at once, not left in pending (4.4.g) -- expiry only ever reads available
	_, err := engine.Grant(ctx, reward.GrantRequest{
		UserID: user, Action: reward.ActionQuickWatched, ExternalRef: unique("ref"),
		Evidence: "checkpoint-token", AllocationID: allocation, HoldbackHours: &noHoldback,
	})
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE ledger.account SET last_activity_at = now() - make_interval(months => $2) WHERE id = $1`,
		ledger.UserAccountID(user, ledger.PurposeAvailable), monthsAgo,
	); err != nil {
		t.Fatalf("clock-shifting activity: %v", err)
	}
	return user
}

// setPointsExpiry proposes and approves a points_expiry setting for region,
// the same two-person shape /api/staff/economy/settings uses. Needs the
// OWNER connection: platform.region_setting is apps/api's own table
// (yourtal_app's), and yourtal_ledger -- what LEDGER_DATABASE_URL connects
// as -- only has SELECT on it through platform.ledger_setting's narrow view.
func setPointsExpiry(t *testing.T, region, value string) {
	t.Helper()
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatalf("connect as owner: %v", err)
	}
	defer owner.Close()
	var id string
	if err := owner.QueryRow(ctx,
		`INSERT INTO platform.region_setting (region, key, value, set_by)
		   VALUES ($1, 'points_expiry', $2::jsonb, $3) RETURNING id`,
		region, value, unique("proposer")).Scan(&id); err != nil {
		t.Fatalf("proposing points_expiry: %v", err)
	}
	if _, err := owner.Exec(ctx,
		`UPDATE platform.region_setting SET approved_by = $2 WHERE id = $1`, id, unique("approver")); err != nil {
		t.Fatalf("approving points_expiry: %v", err)
	}
}

func TestExpiryDoesNothingWhileOff(t *testing.T) {
	pool, engine, _ := setup(t)
	allocation := fundedAllocation(t, engine, 10_000)
	user := grantAndClockShift(t, pool, engine, allocation, 24)

	// The seed's own default: off. No propose/approve here at all.
	result, err := expiry.Run(context.Background(), pool, ledger.New(pool), ledger.RegionID, 1000)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Considered != 0 || result.Expired != 0 {
		t.Errorf("result = %+v, want a fully inert run while expiry is off", result)
	}

	balance, err := ledger.New(pool).Balance(context.Background(), ledger.UserAccountID(user, ledger.PurposeAvailable))
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 60 {
		t.Errorf("available = %d, want the 60 points untouched", balance)
	}
}

func TestExpiryOnPostsBreakageOnceForA12MonthClockShift(t *testing.T) {
	pool, engine, _ := setup(t)
	setPointsExpiry(t, "ID", `{"enabled": true, "inactivityMonths": 12}`)
	allocation := fundedAllocation(t, engine, 10_000)
	user := grantAndClockShift(t, pool, engine, allocation, 13)

	ctx := context.Background()
	book := ledger.New(pool)
	// >=1, not ==1: this region's own points_expiry setting is process-wide
	// (same reasoning live_setting_enforcement_test.go's comment gives for
	// daily_earn_cap), so a run here can also sweep up another test's own
	// clock-shifted fixture that happened to run first in this file while
	// expiry was still off for it. What THIS test owns is proving its own
	// user's balance actually reached zero, below.
	result, err := expiry.Run(ctx, pool, book, ledger.RegionID, 1000)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Expired < 1 {
		t.Errorf("result = %+v, want at least one account expired", result)
	}

	balance, err := book.Balance(ctx, ledger.UserAccountID(user, ledger.PurposeAvailable))
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 0 {
		t.Errorf("available = %d, want 0 after breakage", balance)
	}

	// A second run against the same snapshot posts nothing more (the
	// idempotency key is keyed to the last_activity_at this run saw, and
	// there is nothing left to expire besides).
	again, err := expiry.Run(ctx, pool, book, ledger.RegionID, 1000)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if again.Expired != 0 {
		t.Errorf("a second run expired %d more accounts, want 0 (already zero balance)", again.Expired)
	}
}

// 10.2.d: an account 3 days short of a 1-month cutoff gets a 7-day notice,
// and running again does not write a second one for the same milestone.
func TestExpiryOnWritesA7DayNoticeForAnAccountApproachingItsCutoff(t *testing.T) {
	pool, engine, _ := setup(t)
	setPointsExpiry(t, "ID", `{"enabled": true, "inactivityMonths": 1}`)
	allocation := fundedAllocation(t, engine, 10_000)

	ctx := context.Background()
	var noHoldback int32
	user := unique("usr")
	if _, err := engine.Grant(ctx, reward.GrantRequest{
		UserID: user, Action: reward.ActionQuickWatched, ExternalRef: unique("ref"),
		Evidence: "checkpoint-token", AllocationID: allocation, HoldbackHours: &noHoldback,
	}); err != nil {
		t.Fatalf("grant: %v", err)
	}
	// cutoff (1 month from now, run's own arithmetic) minus 3 days: inside
	// the 7-day lead window, and not yet past the cutoff itself.
	activity := time.Now().AddDate(0, -1, 0).Add(3 * 24 * time.Hour)
	accountID := ledger.UserAccountID(user, ledger.PurposeAvailable)
	if _, err := pool.Exec(ctx, `UPDATE ledger.account SET last_activity_at = $2 WHERE id = $1`, accountID, activity); err != nil {
		t.Fatalf("clock-shifting activity: %v", err)
	}

	book := ledger.New(pool)
	result, err := expiry.Run(ctx, pool, book, ledger.RegionID, 1000)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Notices < 1 {
		t.Errorf("result = %+v, want at least one new notice", result)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger.points_expiry_notice WHERE account_id = $1 AND milestone_days = 7`,
		accountID).Scan(&count); err != nil {
		t.Fatalf("counting notices: %v", err)
	}
	if count != 1 {
		t.Errorf("7-day notices for this account = %d, want 1", count)
	}

	// A second run does not duplicate it (ON CONFLICT DO NOTHING on the
	// same account/milestone/expiring_at).
	if _, err := expiry.Run(ctx, pool, book, ledger.RegionID, 1000); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger.points_expiry_notice WHERE account_id = $1 AND milestone_days = 7`,
		accountID).Scan(&count); err != nil {
		t.Fatalf("recounting notices: %v", err)
	}
	if count != 1 {
		t.Errorf("7-day notices after a second run = %d, want still 1", count)
	}
}

func TestExpiryOnSkipsAnEscrowedAccount(t *testing.T) {
	pool, engine, esc := setup(t)
	setPointsExpiry(t, "ID", `{"enabled": true, "inactivityMonths": 12}`)
	allocation := fundedAllocation(t, engine, 10_000)
	user := grantAndClockShift(t, pool, engine, allocation, 13)

	ctx := context.Background()
	if _, err := esc.Hold(ctx, escrow.Request{UserID: user, Points: 60, Reason: "test hold"}); err != nil {
		t.Fatalf("holding escrow: %v", err)
	}

	book := ledger.New(pool)
	if _, err := expiry.Run(ctx, pool, book, ledger.RegionID, 1000); err != nil {
		t.Fatalf("run: %v", err)
	}

	// What this test owns: ITS OWN escrowed user still holds the full 60 in
	// escrow (untouched) and nothing landed back in available — the
	// aggregate Result is not asserted on here for the same cross-test
	// reason the sibling test above explains.
	available, err := book.Balance(ctx, ledger.UserAccountID(user, ledger.PurposeAvailable))
	if err != nil {
		t.Fatalf("available balance: %v", err)
	}
	if available != 0 {
		t.Errorf("available = %d, want 0 (still escrowed, not expired back into it)", available)
	}
	held, err := sqlcgen.New(pool).UserHasHeldEscrow(ctx, user)
	if err != nil {
		t.Fatalf("checking escrow: %v", err)
	}
	if !held {
		t.Error("the escrow was released or expired through, want it still held")
	}
}
