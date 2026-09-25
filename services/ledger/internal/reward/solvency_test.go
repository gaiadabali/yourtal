package reward_test

import (
	"context"
	"errors"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
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
