package pricing_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/yourtal/services/ledger/internal/pricing"
)

// 4.9.b: rate governance lives in the ledger, not in whoever calls it.

func proposal(backing int64, effective time.Time) pricing.Rate {
	return pricing.Rate{ID: unique("rate"), Currency: testCurrency, MicrosPerPoint: backing,
		IssuePriceMicrosPerPoint: issueAUD, EffectiveFrom: effective, Reason: "governance test", SetBy: "alice"}
}

func TestAProposedRatePricesNothingUntilASecondPersonApproves(t *testing.T) {
	engine, _ := newEngine(t)
	ctx := context.Background()
	at := withRate(t, engine)

	// A year out, so this raise never prices anything another test does:
	// rates are append-only, and a raise in force now would make every later
	// fixture at the F1 rate a cut.
	raise := proposal(backingAUD+100_000, time.Now().AddDate(1, 0, 0))
	if err := engine.ProposeRate(ctx, raise); err != nil {
		t.Fatal(err)
	}
	if rate, _ := engine.RateAt(ctx, testCurrency, raise.EffectiveFrom.Add(time.Minute)); rate.ID == raise.ID {
		t.Fatal("an unapproved proposal is in force")
	}
	if _, err := engine.ApproveRate(ctx, raise.ID, "alice"); !errors.Is(err, pricing.ErrSameApprover) {
		t.Fatalf("self-approval: err = %v, want ErrSameApprover", err)
	}
	effective, err := engine.ApproveRate(ctx, raise.ID, "bob")
	if err != nil {
		t.Fatalf("a raise approved by a second person: %v", err)
	}
	if effective.Before(at) {
		t.Errorf("took effect at %s, before the approval", effective)
	}
	if rate, _ := engine.RateAt(ctx, testCurrency, effective); rate.ID != raise.ID {
		t.Errorf("the approved raise is not in force at %s: %+v", effective, rate)
	}
}

// A cut to B lowers every points price, so it lands no sooner than the
// 15 minutes a locked quote lasts.
func TestACutToBNeedsFifteenMinutesNotice(t *testing.T) {
	engine, _ := newEngine(t)
	ctx := context.Background()
	withRate(t, engine)

	soon := proposal(backingAUD-100_000, time.Now().Add(5*time.Minute))
	if err := engine.ProposeRate(ctx, soon); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.ApproveRate(ctx, soon.ID, "bob"); !errors.Is(err, pricing.ErrRateCutTooSoon) {
		t.Fatalf("a cut in 5 minutes: err = %v, want ErrRateCutTooSoon", err)
	}
	later := proposal(backingAUD-100_000, time.Now().Add(20*time.Minute))
	if err := engine.ProposeRate(ctx, later); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.ApproveRate(ctx, later.ID, "bob"); err != nil {
		t.Fatalf("a cut in 20 minutes: %v", err)
	}
}

func TestAProposalCannotBeBackdated(t *testing.T) {
	engine, _ := newEngine(t)
	if err := engine.ProposeRate(context.Background(), proposal(backingAUD, time.Now().Add(-time.Hour))); err == nil {
		t.Fatal("a rate effective an hour ago was accepted")
	}
}

// F1 is seeded by migration, approved, in both regions.
func TestTheF1RatesAreSeeded(t *testing.T) {
	_, pool := newEngine(t)
	for id, want := range map[string][2]int64{"rate_f1_idr": {6_000_000, 9_000_000}, "rate_f1_aud": {3_000_000, 4_500_000}} {
		var b, p int64
		if err := pool.QueryRow(context.Background(), `SELECT r.micros_per_point, r.issue_price_micros_per_point
			FROM ledger.backing_rate r JOIN ledger.backing_rate_approval a ON a.rate_id = r.id WHERE r.id = $1`, id).Scan(&b, &p); err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		if b != want[0] || p != want[1] {
			t.Errorf("%s = %d / %d, want %d / %d", id, b, p, want[0], want[1])
		}
	}
}
