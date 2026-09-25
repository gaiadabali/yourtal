package pricing_test

import (
	"errors"
	"math"
	"testing"

	"github.com/yourtal/services/ledger/internal/pricing"
)

// IDR is stored in whole Rupiah (FOUNDER DECISION T-1, 2026-09-22), so
// docs/09's worked example in Rupiah is these numbers directly: IDR 6/point
// of backing is 6 whole Rupiah, and 6 Rupiah expressed in micros is
// 6_000_000. No sen-per-Rupiah scaling factor is needed anywhere below —
// a settlement value in Rupiah IS the stored minor-unit amount.
const (
	backingIDR6PerPoint    = 6 * pricing.MicrosPerMinorUnit
	issuePriceIDR8PerPoint = 8 * pricing.MicrosPerMinorUnit
)

// The table from docs/09 §4.1, run as a test.
//
// This is the example the entire economic argument is made on: two suppliers
// offering the same IDR 50,000 voucher at different subsidies get different
// point prices, users see a genuinely better deal from the more generous
// one, and the platform's margin is the same 25% either way. If this table
// ever stops holding, the doc is describing a system we do not have.
func TestTheWorkedExampleFromTheDoc(t *testing.T) {
	cases := []struct {
		name             string
		settlementRupiah int64
		wantPoints       int64
	}{
		{"business A, aggressive subsidy", 12_000, 2_000},
		{"business B, conservative subsidy", 30_000, 5_000},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			points, err := pricing.PriceInPoints(
				testCase.settlementRupiah, backingIDR6PerPoint, pricing.NeutralDemandBps)
			if err != nil {
				t.Fatalf("PriceInPoints: %v", err)
			}
			if points != testCase.wantPoints {
				t.Errorf("S = IDR %d at B = IDR 6/point: got %d points, want %d",
					testCase.settlementRupiah, points, testCase.wantPoints)
			}
		})
	}
}

// The margin claim, checked rather than asserted in prose.
//
// docs/09 §4.1: "the margin is structurally constant, and no supplier can
// price the platform into a loss". That is a claim about every possible
// settlement value, not about the two in the table — so this walks a wide
// range and checks that what the platform collects always exceeds what it
// settles. The property is what makes the spread safe; the doc's table is
// two samples of it.
func TestThePlatformNeverSettlesForMoreThanItCollected(t *testing.T) {
	for settlementRupiah := int64(1); settlementRupiah <= 200_000; settlementRupiah += 37 {
		settlement := settlementRupiah

		points, err := pricing.PriceInPoints(settlement, backingIDR6PerPoint, pricing.NeutralDemandBps)
		if err != nil {
			t.Fatalf("S=%d: %v", settlement, err)
		}

		// What a partner paid for those points, and what the supplier is owed.
		collected, err := pricing.SettlementLiabilityMinor(points, issuePriceIDR8PerPoint)
		if err != nil {
			t.Fatalf("collected: %v", err)
		}

		if collected < settlement {
			t.Fatalf("S=%d Rupiah priced at %d points: collected %d < settled %d — the spread is gone",
				settlement, points, collected, settlement)
		}
	}
}

// Rounding is up, and up is the safe direction. A price that rounded down
// would sell the listing for less than B backs it, in the same direction
// every time, so the shortfall accumulates rather than averaging out.
func TestAFractionalPriceRoundsUp(t *testing.T) {
	// S = 1 Rupiah at B = 6_000_000 micros/point (IDR 6/point) is 1/6 of a point.
	points, err := pricing.PriceInPoints(1, backingIDR6PerPoint, pricing.NeutralDemandBps)
	if err != nil {
		t.Fatalf("PriceInPoints: %v", err)
	}
	if points != 1 {
		t.Errorf("a sub-point settlement value should cost 1 point, got %d", points)
	}

	// 7 Rupiah — one minor unit past an exact 1-point settlement (6) — is
	// 1.166… points, which must not be sold as 1.
	points, err = pricing.PriceInPoints(7, backingIDR6PerPoint, pricing.NeutralDemandBps)
	if err != nil {
		t.Fatalf("PriceInPoints: %v", err)
	}
	if points != 2 {
		t.Errorf("7 Rupiah at B=6 Rupiah/point should round up to 2 points, got %d", points)
	}
}

// The multiplier moves the price in the direction you would expect, and
// only within its bounds.
func TestTheDemandMultiplierIsBounded(t *testing.T) {
	settlement := int64(30_000)

	cheap, err := pricing.PriceInPoints(settlement, backingIDR6PerPoint, pricing.MinDemandMultiplierBps)
	if err != nil {
		t.Fatalf("at the floor: %v", err)
	}
	dear, err := pricing.PriceInPoints(settlement, backingIDR6PerPoint, pricing.MaxDemandMultiplierBps)
	if err != nil {
		t.Fatalf("at the ceiling: %v", err)
	}

	if cheap != 4_000 || dear != 6_250 {
		t.Errorf("bounds produced %d..%d points, want 4000..6250", cheap, dear)
	}

	for _, outOfBounds := range []int32{
		pricing.MinDemandMultiplierBps - 1,
		pricing.MaxDemandMultiplierBps + 1,
		0,
		-10_000,
		1_000_000,
	} {
		if _, err := pricing.PriceInPoints(settlement, backingIDR6PerPoint, outOfBounds); !errors.Is(
			err, pricing.ErrMultiplierOutOfBounds,
		) {
			t.Errorf("multiplier %d bps was accepted; docs/09 §4.2 calls the bounds non-negotiable",
				outOfBounds)
		}
	}
}

// A free listing is an unmetered claim on the reserve. Refused, not zero.
func TestAListingCannotBeFree(t *testing.T) {
	for _, settlement := range []int64{0, -1, -50_000} {
		if _, err := pricing.PriceInPoints(settlement, backingIDR6PerPoint, pricing.NeutralDemandBps); !errors.Is(
			err, pricing.ErrSettlementNotPositive,
		) {
			t.Errorf("settlement %d was priced; it must be refused", settlement)
		}
	}
}

// An overflowed price is a NEGATIVE price — a listing that pays the user to
// take it. The arithmetic goes through math/big precisely so this is an
// error rather than a wrap.
func TestAnAbsurdSettlementValueIsRefusedRatherThanWrapping(t *testing.T) {
	points, err := pricing.PriceInPoints(math.MaxInt64, 1, pricing.MaxDemandMultiplierBps)
	if err == nil {
		t.Fatalf("expected a refusal, got %d points", points)
	}
	if !errors.Is(err, pricing.ErrPriceOutOfRange) {
		t.Errorf("wrong error: %v", err)
	}
}

// The reverse direction, used by the coverage ratio. Rounds up so the
// liability is never understated — the flattering direction is the one that
// hides insolvency.
func TestLiabilityRoundsAgainstThePlatform(t *testing.T) {
	// 1 point at B = 6_000_000 micros (IDR 6/point) is exactly 6 Rupiah.
	exact, err := pricing.SettlementLiabilityMinor(1, backingIDR6PerPoint)
	if err != nil {
		t.Fatalf("SettlementLiabilityMinor: %v", err)
	}
	if exact != 6 {
		t.Errorf("1 point at B=6 Rupiah should be 6 Rupiah, got %d", exact)
	}

	// A B that does not divide evenly must round up, not down.
	rounded, err := pricing.SettlementLiabilityMinor(1, pricing.MicrosPerMinorUnit+1)
	if err != nil {
		t.Fatalf("SettlementLiabilityMinor: %v", err)
	}
	if rounded != 2 {
		t.Errorf("1.000001 minor units of liability must be carried as 2, got %d", rounded)
	}
}
