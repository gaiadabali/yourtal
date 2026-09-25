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
	// LiabilityMinor is those claims valued at B: what honouring them costs.
	LiabilityMinor int64
	// ReserveMinor is what is actually in the segregated reserve.
	ReserveMinor int64
	// RatioBps is Reserve / Liability in basis points. 10_000 is exactly 1.0.
	RatioBps int64
	// NoPointsOutstanding distinguishes "nothing is owed" from a ratio.
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

// Coverage measures the invariant for one data plane.
//
// Both halves are PROJECTIONS over ledger entries, never stored totals. A
// stored coverage figure is a second source of truth about solvency, and the
// one thing worse than not measuring solvency is measuring a copy of it that
// stopped updating.
//
// One region at a time: its currency is fixed, so an AU reserve can never
// mask an ID shortfall.
func (e *Engine) Coverage(
	ctx context.Context, region ledger.Region, at time.Time,
) (Coverage, error) {
	country, currency := string(region), string(region.Currency())
	rate, err := e.RateAt(ctx, currency, at)
	if err != nil {
		return Coverage{}, err
	}

	queries := sqlcgen.New(e.pool)

	points, err := queries.SumPointsOutstanding(ctx, country)
	if err != nil {
		return Coverage{}, fmt.Errorf("summing points outstanding: %w", err)
	}

	// Natural balance: the reserve is an asset, so its entries are debits.
	reserve, err := queries.GetAccountBalance(ctx, ledger.PlatformAccountID(region, ledger.RoleReserve))
	if errors.Is(err, pgx.ErrNoRows) {
		reserve, err = 0, nil
	}
	if err != nil {
		return Coverage{}, fmt.Errorf("reading the reserve balance: %w", err)
	}

	coverage := Coverage{
		Country:           country,
		Currency:          currency,
		PointsOutstanding: points,
		ReserveMinor:      reserve,
		BackingRateID:     rate.ID,
		MeasuredAt:        at,
	}

	if points <= 0 {
		coverage.NoPointsOutstanding = true
		return coverage, nil
	}

	liability, err := SettlementLiabilityMinor(points, rate.MicrosPerPoint)
	if err != nil {
		return Coverage{}, err
	}
	coverage.LiabilityMinor = liability

	// Integer basis points, floored — so a ratio that rounds is reported
	// slightly WORSE than it is. The alternative rounds a 0.99996 up to 1.0
	// and reports an insolvent economy as exactly solvent.
	ratio := new(big.Int).Mul(big.NewInt(reserve), big.NewInt(coverageScale))
	ratio.Quo(ratio, big.NewInt(liability))
	if !ratio.IsInt64() {
		return Coverage{}, fmt.Errorf("%w: reserve=%d liability=%d", ErrPriceOutOfRange, reserve, liability)
	}
	coverage.RatioBps = ratio.Int64()

	return coverage, nil
}
