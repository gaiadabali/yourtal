package reward_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
)

// 4.4.h, K6: every point not paid for by a business is backed by cash at
// the moment of issue (engine-money.md EM-02).

func auEngine(t *testing.T) *reward.Engine {
	t.Helper()
	_, pool := newEngine(t, reward.AlwaysAllow{})
	engine := reward.New(pool, ledger.New(pool), reward.AlwaysAllow{}, ledger.RegionAU).WithCaps(uncapped)
	if err := engine.EnsureChart(context.Background()); err != nil {
		t.Fatal(err)
	}
	return engine
}

func marketingAllocation(t *testing.T, engine *reward.Engine, points int64) string {
	t.Helper()
	id := unique("alloc_mkt")
	if err := engine.CreateAllocation(context.Background(), id, "marketing", "growth", points); err != nil {
		t.Fatalf("marketing allocation: %v", err)
	}
	return id
}

func streak(user, allocation string) reward.GrantRequest {
	req := request(user, allocation, reward.ActionDailyStreak)
	req.Evidence = ""
	return req
}

// A marketing grant moves ceil(points × B) of marketing cash into the
// reserve in its own transaction: 500 pts at B = 3¢ is AUD 15.00.
func TestAMarketingGrantIsBackedByMarketingCash(t *testing.T) {
	engine := auEngine(t)
	ctx := context.Background()
	book := engine.Ledger()
	if _, err := engine.FundMarketing(ctx, unique("fund"), 100_000, "alice", "bob"); err != nil {
		t.Fatalf("FundMarketing: %v", err)
	}
	reserve := ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleReserve)
	cash := ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleMarketingCash)
	reserveBefore, _ := book.Balance(ctx, reserve)
	cashBefore, _ := book.Balance(ctx, cash)

	if _, err := engine.Grant(ctx, streak(unique("usr"), marketingAllocation(t, engine, 10_000))); err != nil {
		t.Fatalf("streak grant: %v", err)
	}
	reserveAfter, _ := book.Balance(ctx, reserve)
	cashAfter, _ := book.Balance(ctx, cash)
	if reserveAfter-reserveBefore != 1_500 || cashBefore-cashAfter != 1_500 {
		t.Errorf("reserve +%d, marketing cash -%d; want 1500 each", reserveAfter-reserveBefore, cashBefore-cashAfter)
	}
}

// 4.4.j: a marketing grant larger than marketing cash is refused.
func TestAMarketingGrantLargerThanMarketingCashIsRefused(t *testing.T) {
	engine := auEngine(t)
	ctx := context.Background()
	user := unique("usr")
	req := request(user, marketingAllocation(t, engine, 100_000), reward.ActionReferralConfirmed)
	req.Evidence = "referral-code"

	// Drain whatever marketing cash other tests funded, then leave 1¢.
	drainMarketingCash(t, engine)
	if _, err := engine.FundMarketing(ctx, unique("fund"), 1, "alice", "bob"); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Grant(ctx, req); !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("5,000 pts (AUD 150) against 1¢ of marketing cash: err = %v", err)
	}
	if b, _ := engine.Ledger().Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending)); b != 0 {
		t.Errorf("the refused grant left %d points", b)
	}
}

// EM-02: the streak test drew a marketing action from a PARTNER allocation,
// so partner money paid for platform marketing.
func TestAMarketingActionCannotDrawAPartnerAllocation(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	partner := fundedAllocation(t, engine, 10_000)
	if _, err := engine.Grant(context.Background(), streak(unique("usr"), partner)); !errors.Is(err, reward.ErrWrongFunder) {
		t.Fatalf("a streak on a partner allocation: err = %v, want ErrWrongFunder", err)
	}
}

// EM-02: CreateAllocation minted partner allocations with no purchase.
func TestAPartnerAllocationNeedsAPurchase(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	if err := engine.CreateAllocation(context.Background(), unique("alloc"), "partner", "adv", 10_000); err == nil {
		t.Fatal("a partner allocation was created with no purchase behind it")
	}
	_, err := pool.Exec(context.Background(), `INSERT INTO ledger.allocation (id, funder_type, funder_id, currency, total_points, remaining_points)
		VALUES ($1, 'partner', 'adv', 'YTP', 1000, 1000)`, unique("alloc"))
	if err == nil {
		t.Fatal("the database took a partner allocation with no purchase")
	}
}

func TestFundingMarketingNeedsTwoPeople(t *testing.T) {
	engine := auEngine(t)
	if _, err := engine.FundMarketing(context.Background(), unique("fund"), 1_000, "alice", "alice"); !errors.Is(err, reward.ErrSameApprover) {
		t.Fatalf("one person funded marketing: err = %v", err)
	}
}

// drainMarketingCash returns every cent of AU marketing cash to platform
// equity, so a test can reason about an exact balance.
func drainMarketingCash(t *testing.T, engine *reward.Engine) {
	t.Helper()
	ctx := context.Background()
	book := engine.Ledger()
	cash, err := book.Balance(ctx, ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleMarketingCash))
	if err != nil {
		t.Fatal(err)
	}
	if cash == 0 {
		return
	}
	if _, err := book.Transfer(ctx, ledger.TransferRequest{
		ID: unique("t"), IdempotencyKey: unique("k"), ReasonCode: "test_drain",
		Entries: ledger.Reverse(ledger.FundMarketing(ledger.RegionAU, cash)),
	}); err != nil {
		t.Fatalf("draining marketing cash: %v", err)
	}
}

// Marketing cash rises only through FundMarketing: a transfer posting the
// same entries without its two-person record is refused at COMMIT.
func TestMarketingCashCannotBeMintedByAPlainTransfer(t *testing.T) {
	engine := auEngine(t)
	_, err := engine.Ledger().Transfer(context.Background(), ledger.TransferRequest{
		ID: unique("t"), IdempotencyKey: unique("k"), ReasonCode: "fund_marketing",
		Entries: ledger.FundMarketing(ledger.RegionAU, 1_000_000),
	})
	if err == nil || !strings.Contains(err.Error(), "only through fundMarketing") {
		t.Fatalf("marketing cash was raised without a funding decision: %v", err)
	}
}
