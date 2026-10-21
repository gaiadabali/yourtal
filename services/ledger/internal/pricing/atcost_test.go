package pricing_test

import (
	"context"
	"errors"
	"math/big"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
)

// F127: a receipt package is the tier sizes at exactly B, rounded up.

func TestF127AtCostPricesAsDecided(t *testing.T) {
	for _, c := range []struct {
		name      string
		points, b int64
		want      int64
	}{
		{"AU starter", 1_000, 3_000_000, 3_000},  // A$30.00
		{"AU grow", 10_000, 3_000_000, 30_000},   // A$300.00
		{"AU scale", 50_000, 3_000_000, 150_000}, // A$1,500.00
		{"ID starter", 1_000, 6_000_000, 6_000},  // IDR 6,000
		{"ID grow", 10_000, 6_000_000, 60_000},   // IDR 60,000
		{"ID scale", 50_000, 6_000_000, 300_000}, // IDR 300,000
		{"a fraction rounds up", 1_000, 3_000_001, 3_001},
	} {
		got, err := pricing.AtCostAmountMinor(c.points, c.b)
		if err != nil || got != c.want {
			t.Errorf("%s = %d (%v), want %d", c.name, got, err, c.want)
		}
	}
}

// The same rounding as the coverage ratio, and never a minor unit under the
// exact points × B the receipt_package trigger checks.
func TestAtCostIsTheK6FloorRoundedUp(t *testing.T) {
	for _, b := range []int64{1, 333_333, 2_999_999, 3_000_000, 3_000_001, 6_000_000, 6_543_211} {
		for _, points := range []int64{1, 999, 1_000, 10_000, 50_000, 100_000_000} {
			got, err := pricing.AtCostAmountMinor(points, b)
			if err != nil {
				t.Fatalf("%d at %d: %v", points, b, err)
			}
			liability, _ := pricing.SettlementLiabilityMinor(points, b)
			if got != liability {
				t.Errorf("%d at %d = %d, the coverage ratio says %d", points, b, got, liability)
			}
			exact := new(big.Int).Mul(big.NewInt(points), big.NewInt(b))
			paid := new(big.Int).Mul(big.NewInt(got), big.NewInt(pricing.MicrosPerMinorUnit))
			if paid.Cmp(exact) < 0 {
				t.Errorf("%d at %d = %d, under points × B", points, b, got)
			}
			if new(big.Int).Sub(paid, exact).Cmp(big.NewInt(pricing.MicrosPerMinorUnit)) >= 0 {
				t.Errorf("%d at %d = %d, a whole minor unit over", points, b, got)
			}
		}
	}
}

func TestAtCostRefusesNonsense(t *testing.T) {
	if _, err := pricing.AtCostAmountMinor(0, 3_000_000); !errors.Is(err, pricing.ErrPointsNotPositive) {
		t.Errorf("zero points: %v", err)
	}
	if _, err := pricing.AtCostAmountMinor(1_000, 0); !errors.Is(err, pricing.ErrBackingRateNotPositive) {
		t.Errorf("no rate: %v", err)
	}
}

// Against the seeded catalogue and the F1 rates: every tier size at B, with
// no discount on the quote.
func TestAtCostTiersAreTheCatalogueAtB(t *testing.T) {
	engine, _ := newEngine(t)
	ctx := context.Background()
	withRate(t, engine)
	inForce(t, engine, pricing.Rate{ID: unique("rate"), Currency: "IDR", MicrosPerPoint: 6_000_000,
		IssuePriceMicrosPerPoint: 9_000_000, Reason: "F1 test fixture", SetBy: "pricing_test"})
	for region, want := range map[ledger.Region][]int64{
		ledger.RegionAU: {3_000, 30_000, 150_000},
		ledger.RegionID: {6_000, 60_000, 300_000},
	} {
		quotes, err := engine.AtCostTiers(ctx, region)
		if err != nil {
			t.Fatalf("%s: %v", region, err)
		}
		if len(quotes) != len(want) {
			t.Fatalf("%s: %d tiers, want %d", region, len(quotes), len(want))
		}
		for i, quote := range quotes {
			if quote.AmountMinor != want[i] || quote.UndiscountedMinor != want[i] || quote.DiscountBps != 0 ||
				quote.Currency != string(region.Currency()) || quote.RateID == "" {
				t.Errorf("%s %s = %+v, want %d at cost", region, quote.Key, quote, want[i])
			}
		}
		starter, err := engine.QuoteAtCost(ctx, region, "starter")
		if err != nil || starter.AmountMinor != want[0] {
			t.Errorf("%s starter = %+v (%v)", region, starter, err)
		}
	}
	if _, err := engine.QuoteAtCost(ctx, ledger.RegionAU, "platinum"); !errors.Is(err, pricing.ErrUnknownTier) {
		t.Errorf("an unknown tier: %v", err)
	}
}
