package pricing_test

import (
	"context"
	"errors"
	"math/big"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/ledgertest"
	"github.com/yourtal/services/ledger/internal/pricing"
)

// 14.13 (F122): package tiers, priced by the ledger, never below B (K6).

func TestF122TiersPriceAsDecided(t *testing.T) {
	for _, c := range []struct {
		name               string
		points, issue, bps int64
		want               int64
	}{
		{"AU starter", 1_000, issueAUD, 0, 4_500},      // A$45.00
		{"AU grow", 10_000, issueAUD, 500, 42_750},     // A$427.50, 5% off A$450
		{"AU scale", 50_000, issueAUD, 1_000, 202_500}, // A$2,025.00, 10% off A$2,250
		{"ID starter", 1_000, 9_000_000, 0, 9_000},
		{"ID grow", 10_000, 9_000_000, 500, 85_500},
		{"ID scale", 50_000, 9_000_000, 1_000, 405_000},
	} {
		got, err := pricing.TierAmountMinor(c.points, c.issue, c.bps)
		if err != nil || got != c.want {
			t.Errorf("%s = %d (%v), want %d", c.name, got, err, c.want)
		}
	}
}

// Rounded up, by less than one minor unit: never under the exact price.
func TestTierPricesRoundInThePlatformsFavour(t *testing.T) {
	for _, issue := range []int64{4_500_000, 4_500_001, 4_499_999, 9_000_000, 3_333_333} {
		for _, bps := range []int64{0, 1, 333, 500, 999, 1_000, 2_501, 5_000} {
			for _, points := range []int64{1_000, 7_000, 10_000, 50_000} {
				got, err := pricing.TierAmountMinor(points, issue, bps)
				if err != nil {
					t.Fatal(err)
				}
				exact := new(big.Int).Mul(big.NewInt(points*issue), big.NewInt(10_000-bps))
				paid := new(big.Int).Mul(big.NewInt(got), big.NewInt(1_000_000*10_000))
				short := new(big.Int).Mul(big.NewInt(got-1), big.NewInt(1_000_000*10_000))
				if paid.Cmp(exact) < 0 || short.Cmp(exact) >= 0 {
					t.Errorf("points=%d issue=%d bps=%d: %d is not the ceiling", points, issue, bps, got)
				}
			}
		}
	}
}

func TestTheBFloor(t *testing.T) {
	tier := func(bps int64) pricing.Tier { return pricing.Tier{Key: "t", Points: 1_000, DiscountBps: bps} }
	// 4.5¢ against B = 3¢: a third off is 3.0015¢, a hair more is under B.
	if err := pricing.CheckTierFloor(tier(3_333), issueAUD, backingAUD); err != nil {
		t.Errorf("3,333 bps off 4.5¢ is still above 3¢: %v", err)
	}
	if err := pricing.CheckTierFloor(tier(3_334), issueAUD, backingAUD); !errors.Is(err, pricing.ErrTierBelowBacking) {
		t.Errorf("3,334 bps off 4.5¢ is under 3¢: err = %v", err)
	}
	// Exactly at B is not below it.
	if err := pricing.CheckTierFloor(tier(2_500), 4_000_000, 3_000_000); err != nil {
		t.Errorf("a price of exactly B: %v", err)
	}
	if err := pricing.CheckTierFloor(tier(2_501), 4_000_000, 3_000_000); !errors.Is(err, pricing.ErrTierBelowBacking) {
		t.Errorf("one basis point under B: err = %v", err)
	}
	// F122: 10% off 4.5¢ is 4.05¢ against 3¢; 10% off IDR 9 is 8.1 against 6.
	tiers, err := pricing.ParseTiers([]byte(ledgertest.F122Tiers))
	if err != nil {
		t.Fatal(err)
	}
	for _, rate := range [][2]int64{{issueAUD, backingAUD}, {9_000_000, 6_000_000}} {
		for _, f122 := range tiers {
			if err := pricing.CheckTierFloor(f122, rate[0], rate[1]); err != nil {
				t.Errorf("F122 %s under B: %v", f122.Key, err)
			}
		}
	}
}

func TestACatalogueIsValidatedStrictly(t *testing.T) {
	for name, raw := range map[string]string{
		"not a list":        `{"key": "starter", "points": 1000, "discountBps": 0}`,
		"empty":             `[]`,
		"unknown field":     `[{"key": "a", "points": 1000, "discountBps": 0, "priceMinor": 1}]`,
		"no discount":       `[{"key": "a", "points": 1000}]`,
		"duplicate key":     `[{"key": "a", "points": 1000, "discountBps": 0}, {"key": "a", "points": 2000, "discountBps": 0}]`,
		"upper-case key":    `[{"key": "Grow", "points": 1000, "discountBps": 0}]`,
		"zero points":       `[{"key": "a", "points": 0, "discountBps": 0}]`,
		"not a pack":        `[{"key": "a", "points": 1500, "discountBps": 0}]`,
		"fractional points": `[{"key": "a", "points": 1000.5, "discountBps": 0}]`,
		"negative discount": `[{"key": "a", "points": 1000, "discountBps": -1}]`,
		"over 50% off":      `[{"key": "a", "points": 1000, "discountBps": 5001}]`,
		"trailing data":     `[{"key": "a", "points": 1000, "discountBps": 0}] []`,
	} {
		if _, err := pricing.ParseTiers([]byte(raw)); !errors.Is(err, pricing.ErrTierCatalogue) {
			t.Errorf("%s: err = %v, want ErrTierCatalogue", name, err)
		}
	}
	if _, err := pricing.ParseTiers([]byte(`[{"key": "a", "points": 1000, "discountBps": 5000}]`)); err != nil {
		t.Errorf("50%% off is the cap, not over it: %v", err)
	}
}

func TestTheSeededCatalogueIsPricedAtTheRateInForce(t *testing.T) {
	engine, _ := newEngine(t)
	withRate(t, engine)
	ctx := context.Background()

	quotes, err := engine.PackageTiers(ctx, ledger.RegionAU)
	if err != nil {
		t.Fatal(err)
	}
	want := []struct {
		key                  string
		points, total, saved int64
	}{{"starter", 1_000, 4_500, 0}, {"grow", 10_000, 42_750, 2_250}, {"scale", 50_000, 202_500, 22_500}}
	if len(quotes) != len(want) {
		t.Fatalf("%d tiers, want %d: %+v", len(quotes), len(want), quotes)
	}
	for i, w := range want {
		q := quotes[i]
		if q.Key != w.key || q.Points != w.points || q.AmountMinor != w.total ||
			q.UndiscountedMinor-q.AmountMinor != w.saved || q.Currency != "AUD" {
			t.Errorf("tier %d = %+v, want %+v", i, q, w)
		}
	}

	grow, err := engine.QuoteTier(ctx, ledger.RegionAU, "grow")
	if err != nil || grow.AmountMinor != 42_750 {
		t.Errorf("grow = %+v (%v), want 42,750", grow, err)
	}
	if _, err := engine.QuoteTier(ctx, ledger.RegionAU, "platinum"); !errors.Is(err, pricing.ErrUnknownTier) {
		t.Errorf("an unknown tier: err = %v, want ErrUnknownTier", err)
	}
}

// K6 holds in the ledger even when an approved setting would break it.
func TestTheLedgerRefusesATierBelowBWhateverTheSettingSays(t *testing.T) {
	engine, _ := newEngine(t)
	withRate(t, engine)
	ctx := context.Background()
	deep := `[{"key": "starter", "points": 1000, "discountBps": 0}, {"key": "deep", "points": 10000, "discountBps": 5000}]`
	ledgertest.WithTiers(t, "AU", deep)

	if _, err := engine.QuoteTier(ctx, ledger.RegionAU, "deep"); !errors.Is(err, pricing.ErrTierBelowBacking) {
		t.Errorf("50%% off 4.5¢ is 2.25¢, under B: err = %v", err)
	}
	quotes, err := engine.PackageTiers(ctx, ledger.RegionAU)
	if err != nil {
		t.Fatal(err)
	}
	if len(quotes) != 1 || quotes[0].Key != "starter" {
		t.Errorf("on sale: %+v, want only starter", quotes)
	}
	if err := engine.CheckTiers(ctx, ledger.RegionAU, []byte(deep)); !errors.Is(err, pricing.ErrTierBelowBacking) {
		t.Errorf("checking the catalogue: err = %v, want ErrTierBelowBacking", err)
	}
	if err := engine.CheckTiers(ctx, ledger.RegionAU, []byte(ledgertest.F122Tiers)); err != nil {
		t.Errorf("F122's catalogue: %v", err)
	}
}
