package reward_test

import (
	"context"
	"errors"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// 4.9.c, EM-10: Grant never checked coverage, so points nobody paid for
// could be issued into an insolvent economy.
func TestMarketingGrantsStopBelowTheCoverageThreshold(t *testing.T) {
	engine := auEngine(t)
	ctx := context.Background()
	book := engine.Ledger()
	if _, err := engine.FundMarketing(ctx, unique("fund"), 1_000_000, "alice", "bob"); err != nil {
		t.Fatal(err)
	}
	allocation := marketingAllocation(t, engine, 100_000)

	// A voucher liability far beyond the reserve: coverage collapses.
	sink := ledger.BurnLiability(ledger.RegionAU, 1_000_000_000_000)
	posted, err := book.Transfer(ctx, ledger.TransferRequest{
		ID: unique("t"), IdempotencyKey: unique("k"), ReasonCode: "test_liability", Entries: sink,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Grant(ctx, streak(unique("usr"), allocation)); !errors.Is(err, reward.ErrSolvencyBlocked) {
		t.Fatalf("a streak under collapsed coverage: err = %v, want ErrSolvencyBlocked", err)
	}

	// Undo it, and marketing grants resume.
	if _, err := book.Transfer(ctx, ledger.TransferRequest{
		ID: unique("t"), IdempotencyKey: unique("k"), ReasonCode: "test_liability_undo",
		Entries: ledger.Reverse(sink), Reverses: posted.TransferID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Grant(ctx, streak(unique("usr"), allocation)); err != nil {
		t.Fatalf("a streak once coverage recovered: %v", err)
	}
}

// F28 (4.4.m): with only marketing points outstanding, the reserve alone is
// exactly points × B, coverage 1.0, under the 1.1 pause. Unspent marketing
// budget counts as reserve, so a funded region keeps paying streaks.
func TestUnspentMarketingBudgetCountsAsReserve(t *testing.T) {
	_, pool := newEngine(t, reward.AlwaysAllow{})
	engine := reward.New(pool, ledger.New(pool), reward.AlwaysAllow{}, ledger.RegionAU).WithCaps(uncapped)
	ctx := context.Background()
	if err := engine.EnsureChart(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.FundMarketing(ctx, unique("fund"), 500_000, "alice", "bob"); err != nil {
		t.Fatal(err)
	}
	allocation := marketingAllocation(t, engine, 100_000)
	for i := range 3 {
		if _, err := engine.Grant(ctx, streak(unique("usr"), allocation)); err != nil {
			t.Fatalf("streak %d with AUD 5,000 of budget: %v", i, err)
		}
	}

	coverage, err := pricing.CoverageNow(ctx, sqlcgen.New(pool), ledger.RegionAU)
	if err != nil {
		t.Fatal(err)
	}
	cash, _ := engine.Ledger().Balance(ctx, ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleMarketingCash))
	if coverage.MarketingCashMinor != cash {
		t.Errorf("marketing cash in coverage = %d, the account holds %d", coverage.MarketingCashMinor, cash)
	}
	want := (coverage.ReserveMinor + coverage.MarketingCashMinor) * 10_000 / coverage.LiabilityMinor
	if coverage.RatioBps != want {
		t.Errorf("ratio = %d bps, want (reserve + marketing cash) ÷ liability = %d", coverage.RatioBps, want)
	}
}
