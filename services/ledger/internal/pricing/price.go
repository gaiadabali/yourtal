// Package pricing computes what a store listing costs in points, and whether
// the platform can still back the points it has issued.
//
// # Why this is in the ledger service and not in the store
//
// docs/09 §4 is the reason the whole package exists. If a supplier can set a
// points price directly, any one of them can underprice and drain the
// platform — and §4 is explicit that this is "not a hypothetical; it is the
// default outcome of letting suppliers set point prices". The fix is a
// division of powers: the supplier declares the SUBSIDY (S, the settlement
// value they will accept), and the platform computes the PRICE.
//
// That split is only real if the two live in different places. Here, the
// backing rate B is in the `ledger` schema, which `yourtal_app` cannot read
// at all — so the store service physically cannot compute a price, even
// wrongly, even on purpose. YT-0130's "a supplier can never set a points
// price directly" is then a property of the grant table rather than of
// everyone remembering.
//
// # Integers all the way down
//
// No float appears anywhere in this file. A price is money; a float price is
// a price that is 1,999.9999999 points on one machine and 2,000 on another,
// and the difference shows up as a user who was charged a point more than
// the screen promised. All arithmetic goes through math/big and lands on an
// exact int64 or an error.
package pricing

import (
	"errors"
	"fmt"
	"math"
	"math/big"
)

// MicrosPerMinorUnit is the scale B is stored at: millionths of one minor
// unit of currency, per point.
//
// The alternative — minor units per point as a plain integer — works for IDR
// (B of IDR 6/point is 600 sen, whole) and breaks for AUD (B of 0.6 cents is
// not). The moment one currency needs a fraction every currency does, or the
// same formula silently means two things depending on where it runs.
const MicrosPerMinorUnit = 1_000_000

// The demand multiplier's bounds, in basis points. docs/09 §4.2 calls these
// non-negotiable: "multiplier bounded (e.g. 0.8–1.25) so prices never move
// shockingly".
//
// They are bounds on a LEVER, not on a price. Dynamic pricing that can move
// a price by an arbitrary factor is indistinguishable, from the user's side,
// from a platform that changes its mind about what their effort was worth —
// and docs/09 §12 lists "users conclude the platform devalued their effort
// and leave loudly" as one of the four ways this subsystem fails quietly.
const (
	MinDemandMultiplierBps = 8_000  // 0.80
	MaxDemandMultiplierBps = 12_500 // 1.25
	NeutralDemandBps       = 10_000 // 1.00 — launch with this (docs/09 §11)
	bpsScale               = 10_000
)

var (
	// ErrSettlementNotPositive — a listing whose settlement value is zero or
	// negative. Refused rather than priced at zero: a free listing is an
	// unbounded claim on the reserve, and the honest way to give something
	// away is a promotion with a funding record behind it.
	ErrSettlementNotPositive = errors.New("pricing: settlement value must be positive")
	// ErrMultiplierOutOfBounds — see the constants above.
	ErrMultiplierOutOfBounds = errors.New("pricing: demand multiplier is outside its bounds")
	// ErrBackingRateNotPositive — B of zero would make every price infinite.
	ErrBackingRateNotPositive = errors.New("pricing: backing rate must be positive")
	// ErrPriceOutOfRange — the computed price does not fit in an int64. Only
	// reachable with an absurd settlement value, and returned rather than
	// wrapped around, because a wrapped price is a negative one.
	ErrPriceOutOfRange = errors.New("pricing: computed price does not fit in int64")
)

// Quote is one computed price, with everything needed to explain it later.
//
// The inputs travel with the output on purpose. docs/09 §4.2 requires price
// changes to be "logged and auditable per SKU", and an audit row holding
// only the resulting number cannot answer the question anyone actually asks
// — "why did this go from 2,000 to 2,400 points?" — because the two candidate
// causes (the supplier changed S, or the platform changed B) are
// indistinguishable from the price alone.
type Quote struct {
	// PricePoints is what the user pays. Always at least 1.
	PricePoints int64
	// SettlementMinor is S, the declared value the supplier will be paid.
	SettlementMinor int64
	// BackingMicrosPerPoint is B at the moment of quoting.
	BackingMicrosPerPoint int64
	// BackingRateID names the exact rate row, so a reprice is attributable
	// to a specific, reasoned change rather than to "the rate at the time".
	BackingRateID string
	// DemandMultiplierBps is the multiplier applied, in basis points.
	DemandMultiplierBps int32
}

// PriceInPoints is docs/09 §4.1's formula:
//
//	points_price = (S / B) × demand_multiplier
//
// with S in minor units, B in micros per point, and the multiplier in basis
// points. Expanded to integers:
//
//	points = ceil( S × 1e6 × bps / (B × 1e4) )  =  ceil( S × 100 × bps / B )
//
// # Rounding is always UP, and that is a decision
//
// A fractional price has to go somewhere. Rounding down sells the listing
// for slightly less than B backs, every time, in the same direction — so the
// shortfall is systematic rather than averaging out, and it comes out of the
// margin that docs/09 §3 says the whole economy rests on. Rounding up costs
// a user at most one point on a purchase of thousands, and keeps the
// invariant "a redemption never settles for more than it collected" true by
// construction instead of on average.
//
// The floor of 1 point exists for the same reason: a listing that costs zero
// points is an unmetered claim on the reserve, and with a small enough S the
// formula would otherwise produce one.
func PriceInPoints(settlementMinor, backingMicrosPerPoint int64, demandBps int32) (int64, error) {
	if settlementMinor <= 0 {
		return 0, fmt.Errorf("%w: got %d", ErrSettlementNotPositive, settlementMinor)
	}
	if backingMicrosPerPoint <= 0 {
		return 0, fmt.Errorf("%w: got %d", ErrBackingRateNotPositive, backingMicrosPerPoint)
	}
	if demandBps < MinDemandMultiplierBps || demandBps > MaxDemandMultiplierBps {
		return 0, fmt.Errorf("%w: %d is outside %d..%d",
			ErrMultiplierOutOfBounds, demandBps, MinDemandMultiplierBps, MaxDemandMultiplierBps)
	}

	// numerator = S × 1e6 × bps, denominator = B × 1e4.
	//
	// big.Int rather than int64 because the intermediate product overflows
	// for a large enough S, and an overflowed price is a NEGATIVE price —
	// a listing that pays the user to take it. The cost is an allocation on
	// a path that runs once per listing edit and once per quote, not per
	// request served.
	numerator := new(big.Int).Mul(big.NewInt(settlementMinor), big.NewInt(MicrosPerMinorUnit))
	numerator.Mul(numerator, big.NewInt(int64(demandBps)))

	denominator := new(big.Int).Mul(big.NewInt(backingMicrosPerPoint), big.NewInt(bpsScale))

	points, remainder := new(big.Int).QuoRem(numerator, denominator, new(big.Int))
	if remainder.Sign() != 0 {
		points.Add(points, big.NewInt(1)) // ceiling; see the doc comment
	}

	if !points.IsInt64() || points.Int64() > math.MaxInt64 {
		return 0, fmt.Errorf("%w: S=%d B=%d", ErrPriceOutOfRange, settlementMinor, backingMicrosPerPoint)
	}

	if points.Int64() < 1 {
		return 1, nil
	}
	return points.Int64(), nil
}

// SettlementLiabilityMinor is the other direction: what the platform owes in
// currency if `points` were all spent at rate B.
//
//	minor = ceil( points × B / 1e6 )
//
// Used by the coverage ratio (docs/09 §5). Rounds UP, which overstates the
// liability by at most one minor unit — the conservative direction for a
// solvency measure, where being wrong in the flattering direction is the
// whole failure mode.
func SettlementLiabilityMinor(points, backingMicrosPerPoint int64) (int64, error) {
	if points < 0 {
		return 0, fmt.Errorf("pricing: points outstanding cannot be negative, got %d", points)
	}
	if backingMicrosPerPoint <= 0 {
		return 0, fmt.Errorf("%w: got %d", ErrBackingRateNotPositive, backingMicrosPerPoint)
	}

	product := new(big.Int).Mul(big.NewInt(points), big.NewInt(backingMicrosPerPoint))
	minor, remainder := new(big.Int).QuoRem(product, big.NewInt(MicrosPerMinorUnit), new(big.Int))
	if remainder.Sign() != 0 {
		minor.Add(minor, big.NewInt(1))
	}

	if !minor.IsInt64() {
		return 0, fmt.Errorf("%w: points=%d B=%d", ErrPriceOutOfRange, points, backingMicrosPerPoint)
	}
	return minor.Int64(), nil
}
