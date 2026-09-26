package pricing

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// The coverage thresholds from docs/09 §5, in basis points.
//
//	Reserve / (points outstanding × B) ≥ 1.0,  alert below 1.2
//
// Two numbers rather than one because they mean different things. Below
// 1.2 is a warning with time to act — add inventory, adjust a multiplier
// (§6 levers 1 and 2, the gentle ones). Below 1.0 the platform has issued
// more claims than it can honour, and every lever left is one a user feels.
const (
	CoverageFloorBps = 10_000 // 1.00 — below this the economy is insolvent
	CoverageAlertBps = 12_000 // 1.20 — below this someone is woken up
	coverageScale    = 10_000
)

// Coverage is the solvency invariant, measured.
//
// docs/09 §5 calls it "the single most important rule in the platform", and
// §12 gives the reason it is measured rather than assumed: insolvency by
// unfunded faucet is "discovered a year later". The failure is silent, so
// the check has to be loud and continuous — this is what the ledger's
// 15-minute invariant job reports alongside the double-entry check.
type Coverage struct {
	// Country and Currency scope the measurement. The two data planes are
	// isolated (docs/03), so a coverage ratio that mixed them would let a
	// well-funded Australian reserve conceal an Indonesian shortfall.
	Country  string
	Currency string
	// PointsOutstanding is points held by users — the claims.
	PointsOutstanding int64
	// LiabilityMinor is everything owed, in the region currency: the points
	// valued at B, plus face value owed on live vouchers, plus captures not
	// yet paid out to merchants (4.9.c). Burned points leave the first term
	// and arrive in the second, so a burn never flatters the ratio (D11).
	LiabilityMinor        int64
	VoucherLiabilityMinor int64
	MerchantPayableMinor  int64
	// ReserveMinor is what is actually in the segregated reserve.
	ReserveMinor int64
	// MarketingCashMinor is the marketing budget not yet moved into reserve.
	// It counts toward the ratio (F28): it exists only to back points.
	MarketingCashMinor int64
	// RatioBps is Reserve / Liability in basis points. 10_000 is exactly 1.0.
	RatioBps int64
	// NoPointsOutstanding means nothing at all is owed, which is not a ratio.
	//
	// Without it, zero liability has to be reported as either an infinite
	// ratio or a zero one, and a zero would read as total insolvency on
	// the day before launch — the single most alarming possible false
	// positive, on the day nobody yet trusts the alert.
	NoPointsOutstanding bool
	// BackingRateID is the rate this was measured at, because a coverage
	// figure without its B is not reproducible.
	BackingRateID string
	MeasuredAt    time.Time
}

// Healthy is the floor: the platform can honour what it has issued.
func (c Coverage) Healthy() bool { return c.NoPointsOutstanding || c.RatioBps >= CoverageFloorBps }

// ShouldAlert is the earlier warning, while the gentle levers still work.
func (c Coverage) ShouldAlert() bool {
	return !c.NoPointsOutstanding && c.RatioBps < CoverageAlertBps
}

// Coverage measures the invariant for one region at an instant.
func (e *Engine) Coverage(ctx context.Context, region ledger.Region, at time.Time) (Coverage, error) {
	rate, err := e.RateAt(ctx, string(region.Currency()), at)
	if err != nil {
		return Coverage{}, err
	}
	return measure(ctx, sqlcgen.New(e.pool), region, rate.ID, rate.MicrosPerPoint, at)
}

// CoverageNow measures inside the caller's transaction at the rate in force
// by the database's clock, for a check that must see the same state as the
// write it guards (4.9.c, EM-10).
func CoverageNow(ctx context.Context, q *sqlcgen.Queries, region ledger.Region) (Coverage, error) {
	rate, err := q.GetBackingRateInForce(ctx, string(region.Currency()))
	if errors.Is(err, pgx.ErrNoRows) {
		return Coverage{}, fmt.Errorf("%w: %s", ErrNoRateInForce, region.Currency())
	}
	if err != nil {
		return Coverage{}, fmt.Errorf("reading the rate in force: %w", err)
	}
	return measure(ctx, q, region, rate.ID, rate.MicrosPerPoint, time.Now().UTC())
}

// measure is reserve ÷ (points × B + voucher liability + merchant payable).
// Every term is a projection over entries, never a stored total.
func measure(
	ctx context.Context, q *sqlcgen.Queries, region ledger.Region, rateID string, backingMicros int64, at time.Time,
) (Coverage, error) {
	points, err := q.SumPointsOutstanding(ctx, string(region))
	if err != nil {
		return Coverage{}, fmt.Errorf("summing points outstanding: %w", err)
	}
	reserve, err := naturalBalance(ctx, q, ledger.PlatformAccountID(region, ledger.RoleReserve))
	if err != nil {
		return Coverage{}, err
	}
	marketingCash, err := naturalBalance(ctx, q, ledger.PlatformAccountID(region, ledger.RoleMarketingCash))
	if err != nil {
		return Coverage{}, err
	}
	vouchers, err := naturalBalance(ctx, q, ledger.PlatformAccountID(region, ledger.RoleVoucherLiability))
	if err != nil {
		return Coverage{}, err
	}
	payable, err := q.SumMerchantPayables(ctx, string(region))
	if err != nil {
		return Coverage{}, fmt.Errorf("summing merchant payables: %w", err)
	}

	c := Coverage{
		Country: string(region), Currency: string(region.Currency()),
		PointsOutstanding: points, ReserveMinor: reserve, MarketingCashMinor: marketingCash,
		VoucherLiabilityMinor: vouchers, MerchantPayableMinor: payable,
		BackingRateID: rateID, MeasuredAt: at,
	}
	var pointsValue int64
	if points > 0 {
		if pointsValue, err = SettlementLiabilityMinor(points, backingMicros); err != nil {
			return Coverage{}, err
		}
	}
	liability := new(big.Int).Add(big.NewInt(pointsValue), big.NewInt(vouchers))
	liability.Add(liability, big.NewInt(payable))
	if liability.Sign() <= 0 {
		c.NoPointsOutstanding = true
		return c, nil
	}
	if !liability.IsInt64() {
		return Coverage{}, fmt.Errorf("%w: liability beyond int64", ErrPriceOutOfRange)
	}
	c.LiabilityMinor = liability.Int64()

	// Integer basis points, floored: a ratio that rounds is reported slightly
	// WORSE than it is, never an insolvent economy as exactly solvent.
	ratio := new(big.Int).Mul(big.NewInt(reserve+marketingCash), big.NewInt(coverageScale))
	ratio.Quo(ratio, liability)
	if !ratio.IsInt64() {
		return Coverage{}, fmt.Errorf("%w: reserve=%d marketing=%d liability=%s", ErrPriceOutOfRange, reserve, marketingCash, liability)
	}
	c.RatioBps = ratio.Int64()
	return c, nil
}

func naturalBalance(ctx context.Context, q *sqlcgen.Queries, accountID string) (int64, error) {
	balance, err := q.GetAccountBalance(ctx, accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("reading %s: %w", accountID, err)
	}
	return balance, nil
}
