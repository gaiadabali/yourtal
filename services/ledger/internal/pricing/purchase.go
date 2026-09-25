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

// PackPoints is the purchase unit (F12): AU 1,000 pts = AUD 45.00, ID 1,000
// pts = IDR 9,000 at the F1 rates.
const PackPoints = 1_000

var (
	// ErrMarginTooThin — B × 1.25 must not exceed P_issue (EM-11).
	ErrMarginTooThin = errors.New("pricing: the spread does not cover the 0.80 demand floor")
	// ErrNotAPack — points are sold in multiples of PackPoints (F12).
	ErrNotAPack = errors.New("pricing: points are sold in packs of 1,000")
)

// marginCovered is B × 1.25 ≤ P_issue in integers; the database CHECK
// backing_rate_margin is the same inequality.
func marginCovered(backingMicros, issueMicros int64) bool {
	return new(big.Int).Mul(big.NewInt(backingMicros), big.NewInt(5)).
		Cmp(new(big.Int).Mul(big.NewInt(issueMicros), big.NewInt(4))) <= 0
}

// PurchaseQuote is what the server charges for a number of points.
type PurchaseQuote struct {
	Points      int64
	AmountMinor int64
	Currency    string
	RateID      string
}

// QuotePurchase prices a points purchase at the issue price in force now.
// The server sets the charge; a partner never names its own price.
func (e *Engine) QuotePurchase(ctx context.Context, region ledger.Region, points int64) (PurchaseQuote, error) {
	return QuotePurchaseIn(ctx, sqlcgen.New(e.pool), region, points)
}

// QuotePurchaseIn is QuotePurchase on the caller's queries, so a purchase can
// price and record inside one transaction.
func QuotePurchaseIn(ctx context.Context, q *sqlcgen.Queries, region ledger.Region, points int64) (PurchaseQuote, error) {
	if points <= 0 || points%PackPoints != 0 {
		return PurchaseQuote{}, fmt.Errorf("%w: %d", ErrNotAPack, points)
	}
	currency := string(region.Currency())
	rate, err := q.GetBackingRateInForce(ctx, currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return PurchaseQuote{}, fmt.Errorf("%w: %s", ErrNoRateInForce, currency)
	}
	if err != nil {
		return PurchaseQuote{}, fmt.Errorf("reading the rate in force: %w", err)
	}
	// ceil(points × P_issue ÷ 1e6), in big.Int: never undercharge by rounding.
	amount := new(big.Int).Mul(big.NewInt(points), big.NewInt(rate.IssuePriceMicrosPerPoint))
	amount.Add(amount, big.NewInt(MicrosPerMinorUnit-1))
	amount.Quo(amount, big.NewInt(MicrosPerMinorUnit))
	if !amount.IsInt64() {
		return PurchaseQuote{}, fmt.Errorf("%w: %d points", ErrPriceOutOfRange, points)
	}
	return PurchaseQuote{Points: points, AmountMinor: amount.Int64(), Currency: currency, RateID: rate.ID}, nil
}
