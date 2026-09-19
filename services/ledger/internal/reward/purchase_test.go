package reward_test

import (
	"context"
	"errors"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
)

// YT-0046, against the real Postgres.
//
// The assertions worth having are about what is RECORDED, not what is
// computed — because nothing here computes. Both facts of a purchase go on
// the record; the rate is an output anyone can derive from them later.

func purchase(id, partner string, points, amount int64) reward.PurchaseRequest {
	return reward.PurchaseRequest{
		ID: id, PartnerID: partner, Points: points, AmountMinor: amount, Currency: "IDR",
	}
}

func TestPurchaseRecordsBothFactsAndFundsTheReserve(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	partner := unique("adv")
	result, err := engine.RecordPurchase(ctx, purchase(unique("pur"), partner, 1_000_000, 25_000_000))
	if err != nil {
		t.Fatalf("purchase: %v", err)
	}

	// Fact one: the points are allocated and drawable.
	remaining, err := engine.RemainingPoints(ctx, result.AllocationID)
	if err != nil {
		t.Fatalf("remaining: %v", err)
	}
	if remaining != 1_000_000 {
		t.Errorf("allocation = %d, want 1000000", remaining)
	}

	// Fact two: the cash reached the segregated reserve, in the currency it
	// was paid in.
	book := ledger.New(pool)
	reserve, err := book.Balance(ctx, ledger.ReserveAccountID("IDR"))
	if err != nil {
		t.Fatalf("reserve: %v", err)
	}
	if reserve < 25_000_000 {
		t.Errorf("reserve holds %d, want at least this purchase's 25000000", reserve)
	}

	// And both are on one row, which is the audit trail.
	purchases, err := engine.PartnerPurchases(ctx, partner)
	if err != nil {
		t.Fatalf("purchases: %v", err)
	}
	if len(purchases) != 1 {
		t.Fatalf("recorded %d purchases, want 1", len(purchases))
	}
	if purchases[0].Points != 1_000_000 || purchases[0].AmountMinor != 25_000_000 {
		t.Errorf("recorded %d points for %d, want the pair as agreed",
			purchases[0].Points, purchases[0].AmountMinor)
	}
	if purchases[0].Currency != "IDR" {
		t.Errorf("currency = %q; an untagged amount cannot be settled", purchases[0].Currency)
	}
}

// The property that lets this ship while YT-0506 is open: both sides are on
// the record, so a rate is derivable later rather than assumed now.
func TestBothSidesAreRecordedSoTheRateIsDerivableLater(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	partner := unique("adv")
	for _, p := range []struct{ points, amount int64 }{
		{1_000_000, 25_000_000},
		{500_000, 15_000_000}, // a different commercial rate, deliberately
	} {
		if _, err := engine.RecordPurchase(ctx, purchase(unique("pur"), partner, p.points, p.amount)); err != nil {
			t.Fatalf("purchase: %v", err)
		}
	}

	purchases, err := engine.PartnerPurchases(ctx, partner)
	if err != nil {
		t.Fatalf("purchases: %v", err)
	}
	if len(purchases) != 2 {
		t.Fatalf("recorded %d, want 2", len(purchases))
	}

	// Two purchases at genuinely different rates. If the system had stored a
	// single rate instead of the pairs, one of these would now be wrong — and
	// which one would be unknowable. Deriving from history keeps both true.
	first := float64(purchases[0].AmountMinor) / float64(purchases[0].Points)
	second := float64(purchases[1].AmountMinor) / float64(purchases[1].Points)
	if first == second {
		t.Error("the fixture no longer exercises two different rates")
	}
}

func TestPurchaseAndAllocationAreAtomic(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	book := ledger.New(pool)
	before, err := book.Balance(ctx, ledger.ReserveAccountID("IDR"))
	if err != nil {
		t.Fatalf("reserve: %v", err)
	}

	// A duplicate id: the retry of a purchase that already happened. It must
	// create neither a second allocation nor a second reserve posting —
	// cash received against nothing is the same defect as points without
	// cash, pointing the other way, and harder to notice.
	id := unique("pur")
	partner := unique("adv")
	if _, err := engine.RecordPurchase(ctx, purchase(id, partner, 1_000, 5_000)); err != nil {
		t.Fatalf("first: %v", err)
	}
	if _, err := engine.RecordPurchase(ctx, purchase(id, partner, 1_000, 5_000)); err == nil {
		t.Fatal("a repeated purchase id created a second allocation")
	}

	after, err := book.Balance(ctx, ledger.ReserveAccountID("IDR"))
	if err != nil {
		t.Fatalf("reserve: %v", err)
	}
	if after != before+5_000 {
		t.Errorf("reserve moved by %d, want exactly one purchase's 5000", after-before)
	}
}

// The AC, end to end: a campaign draws down against the allocation a
// purchase created, and hard-stops at zero.
func TestAPurchaseFundsGrantsUntilItIsExhausted(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	// Exactly two completions' worth.
	result, err := engine.RecordPurchase(ctx, purchase(unique("pur"), unique("adv"), 4_800, 120_000))
	if err != nil {
		t.Fatalf("purchase: %v", err)
	}

	user := unique("usr")
	for i := 0; i < 2; i++ {
		if _, err := engine.Grant(ctx, request(user, result.AllocationID, reward.ActionWatchCompleted)); err != nil {
			t.Fatalf("grant %d: %v", i, err)
		}
	}

	// Hard stop. Not queued, not deferred — refused.
	_, err = engine.Grant(ctx, request(user, result.AllocationID, reward.ActionWatchCompleted))
	if !errors.Is(err, reward.ErrAllocationExhausted) {
		t.Fatalf("third grant err = %v, want ErrAllocationExhausted", err)
	}
}

func TestPurchaseRejectsNonsense(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	cases := []struct {
		name string
		req  reward.PurchaseRequest
		want error
	}{
		{
			// An allocation nobody paid for is exactly what K6 forbids.
			name: "points with no payment",
			req:  reward.PurchaseRequest{ID: unique("p"), PartnerID: "a", Points: 100, AmountMinor: 0, Currency: "IDR"},
			want: reward.ErrPurchaseNotPositive,
		},
		{
			// Cash received against nothing — money in, no obligation recorded.
			name: "payment with no points",
			req:  reward.PurchaseRequest{ID: unique("p"), PartnerID: "a", Points: 0, AmountMinor: 100, Currency: "IDR"},
			want: reward.ErrPurchaseNotPositive,
		},
		{
			name: "a currency the ledger does not hold",
			req:  reward.PurchaseRequest{ID: unique("p"), PartnerID: "a", Points: 1, AmountMinor: 1, Currency: "USD"},
			want: reward.ErrPurchaseCurrencyUnknown,
		},
		{
			// Points are not a payment currency. Buying points with points is
			// not a purchase, and the reserve would hold something it cannot
			// settle with.
			name: "paid in points",
			req:  reward.PurchaseRequest{ID: unique("p"), PartnerID: "a", Points: 1, AmountMinor: 1, Currency: "YTP"},
			want: reward.ErrPurchaseCurrencyUnknown,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := engine.RecordPurchase(ctx, tc.req); !errors.Is(err, tc.want) {
				t.Errorf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestReserveIsSegregatedPerCurrency(t *testing.T) {
	// docs/03 requires a segregated reserve, and a single account holding two
	// currencies would have a balance that is a number with no unit. Keeping
	// them separate is what lets anyone ask "how much IDR is held".
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	if _, err := engine.RecordPurchase(ctx, purchase(unique("pur"), unique("adv"), 100, 900)); err != nil {
		t.Fatalf("idr purchase: %v", err)
	}

	aud := reward.PurchaseRequest{
		ID: unique("pur"), PartnerID: unique("adv"), Points: 100, AmountMinor: 700, Currency: "AUD",
	}
	if _, err := engine.RecordPurchase(ctx, aud); err != nil {
		t.Fatalf("aud purchase: %v", err)
	}

	book := ledger.New(pool)
	idr, _ := book.Balance(ctx, ledger.ReserveAccountID("IDR"))
	audBalance, _ := book.Balance(ctx, ledger.ReserveAccountID("AUD"))

	if idr == 0 || audBalance == 0 {
		t.Fatal("both reserves should hold something")
	}
	if ledger.ReserveAccountID("IDR") == ledger.ReserveAccountID("AUD") {
		t.Error("the two currencies share one reserve account")
	}
}
