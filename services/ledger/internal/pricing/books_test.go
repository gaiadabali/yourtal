package pricing_test

import (
	"context"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// 4.2.d: the books balance by account kind, a purchase raises assets and
// liabilities together (the old FundReserve lowered liabilities), and a
// 100-point grant is 100 points outstanding, not "nothing owed".
func TestAPurchaseAndAGrantKeepTheBooksBalanced(t *testing.T) {
	engine, pool := newEngine(t)
	ctx := context.Background()
	at := withRate(t, engine)
	book := ledger.New(pool)

	rewards := reward.New(pool, book, reward.AlwaysAllow{}, ledger.RegionAU)
	if err := rewards.EnsureChart(ctx); err != nil {
		t.Fatal(err)
	}
	before := trialBalance(t, book)
	coverageBefore, err := engine.Coverage(ctx, ledger.RegionAU, at)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := rewards.RecordPurchase(ctx, reward.PurchaseRequest{
		ID: unique("pur"), PartnerID: unique("partner"), Points: 1_000, AmountMinor: 4_500, Currency: "AUD",
	}); err != nil {
		t.Fatalf("RecordPurchase: %v", err)
	}
	afterPurchase := trialBalance(t, book)
	aud := func(tb ledger.TrialBalance, k ledger.AccountKind) int64 { return tb[ledger.CurrencyAUD][k] }
	if d := aud(afterPurchase, ledger.KindAsset) - aud(before, ledger.KindAsset); d != 4_500 {
		t.Errorf("assets moved by %d, want +4500", d)
	}
	if d := aud(afterPurchase, ledger.KindLiability) - aud(before, ledger.KindLiability); d != 4_500 {
		t.Errorf("liabilities moved by %d, want +4500", d)
	}

	user := unique("usr")
	queries := sqlcgen.New(pool)
	for _, a := range ledger.UserAccounts(user, ledger.RegionAU) {
		if err := queries.InsertAccount(ctx, sqlcgen.InsertAccountParams{
			ID: a.ID, OwnerType: string(a.OwnerType), OwnerID: a.OwnerID, Currency: string(a.Currency),
			Kind: string(a.Kind), Country: a.Country, Purpose: string(a.Purpose),
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := book.Transfer(ctx, ledger.TransferRequest{
		ID: unique("t"), IdempotencyKey: unique("k"), ReasonCode: "test_grant",
		Entries: ledger.GrantPartner(ledger.RegionAU, user, 100),
	}); err != nil {
		t.Fatalf("grant: %v", err)
	}
	trialBalance(t, book)

	coverage, err := engine.Coverage(ctx, ledger.RegionAU, at)
	if err != nil {
		t.Fatal(err)
	}
	if d := coverage.PointsOutstanding - coverageBefore.PointsOutstanding; d != 100 {
		t.Errorf("points outstanding moved by %d, want +100", d)
	}
	if coverage.NoPointsOutstanding {
		t.Error("a 100-point grant reads as nothing owed")
	}
	if d := coverage.ReserveMinor - coverageBefore.ReserveMinor; d != 4_500 {
		t.Errorf("reserve moved by %d, want +4500", d)
	}
}

func trialBalance(t *testing.T, book *ledger.Ledger) ledger.TrialBalance {
	t.Helper()
	tb, err := book.TrialBalance(context.Background(), ledger.RegionAU)
	if err != nil {
		t.Fatal(err)
	}
	if err := tb.Check(); err != nil {
		t.Fatal(err)
	}
	return tb
}
