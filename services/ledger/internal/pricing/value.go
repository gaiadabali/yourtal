package pricing

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// ErrPointsNotPositive — a valuation of zero or fewer points is meaningless.
var ErrPointsNotPositive = errors.New("pricing: points must be positive")

// ValuePoints prices any positive point count at the issue price in force
// now (P_issue) — never B, the backing rate (YT-0130). Unlike QuotePurchase,
// there is no pack-multiple requirement: this is not a purchase, it is a
// VALUATION. TASKS.md 7.3.h needs the cash value of a single completion's
// reward (base + accuracy bonus) for Studio's own risk banner, and a
// per-completion reward is a small number that will only ever coincidentally
// be a multiple of PackPoints — calling QuotePurchase for it is F61's own
// bug (`ErrNotAPack` on every real reward).
func (e *Engine) ValuePoints(ctx context.Context, region ledger.Region, points int64) (PurchaseQuote, error) {
	return ValuePointsIn(ctx, sqlcgen.New(e.pool), region, points)
}

// ValuePointsIn is ValuePoints on the caller's queries.
func ValuePointsIn(ctx context.Context, q *sqlcgen.Queries, region ledger.Region, points int64) (PurchaseQuote, error) {
	if points <= 0 {
		return PurchaseQuote{}, fmt.Errorf("%w: %d", ErrPointsNotPositive, points)
	}
	currency := string(region.Currency())
	rate, err := q.GetBackingRateInForce(ctx, currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return PurchaseQuote{}, fmt.Errorf("%w: %s", ErrNoRateInForce, currency)
	}
	if err != nil {
		return PurchaseQuote{}, fmt.Errorf("reading the rate in force: %w", err)
	}
	amountMinor, err := priceAtIssueRate(points, rate.IssuePriceMicrosPerPoint)
	if err != nil {
		return PurchaseQuote{}, err
	}
	return PurchaseQuote{Points: points, AmountMinor: amountMinor, Currency: currency, RateID: rate.ID}, nil
}

// priceAtIssueRate is ceil(points × P_issue ÷ 1e6), in big.Int: never
// undercharge — or, for a valuation, never understate what a reward is
// worth — by rounding. The one formula QuotePurchase (packs) and ValuePoints
// (any count) share; only the input validation ahead of it differs.
func priceAtIssueRate(points, issuePriceMicrosPerPoint int64) (int64, error) {
	amount := new(big.Int).Mul(big.NewInt(points), big.NewInt(issuePriceMicrosPerPoint))
	amount.Add(amount, big.NewInt(MicrosPerMinorUnit-1))
	amount.Quo(amount, big.NewInt(MicrosPerMinorUnit))
	if !amount.IsInt64() {
		return 0, fmt.Errorf("%w: %d points", ErrPriceOutOfRange, points)
	}
	return amount.Int64(), nil
}
