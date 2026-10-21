package pricing

import (
	"context"
	"fmt"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/settings"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Receipt packages (F127, docs/27 §3.2): the receipt funder buys the tier
// sizes at exactly B, no discount. At cost carries no spread, so the price is
// the K6 floor itself: ceil(points × B), the same rounding as the coverage
// ratio and the receipt_package trigger, never a minor unit under it.

// AtCostAmountMinor is ceil(points × B ÷ 1e6).
func AtCostAmountMinor(points, backingMicrosPerPoint int64) (int64, error) {
	if points <= 0 {
		return 0, fmt.Errorf("%w: %d", ErrPointsNotPositive, points)
	}
	return SettlementLiabilityMinor(points, backingMicrosPerPoint)
}

// quoteAtCost prices one tier's size at a rate. The tier's discount does not
// apply, so the quote carries none and its undiscounted price is its price.
func quoteAtCost(tier Tier, rate sqlcgen.GetBackingRateInForceRow) (TierQuote, error) {
	amount, err := AtCostAmountMinor(tier.Points, rate.MicrosPerPoint)
	if err != nil {
		return TierQuote{}, err
	}
	tier.DiscountBps = 0
	return TierQuote{Tier: tier, AmountMinor: amount, UndiscountedMinor: amount,
		Currency: rate.Currency, RateID: rate.ID}, nil
}

// QuoteAtCostIn prices the named tier at cost inside the caller's
// transaction: the catalogue and the rate in force are both read there, at
// the database's now(), so RateID is the rate the trigger checks at COMMIT.
func QuoteAtCostIn(ctx context.Context, q *sqlcgen.Queries, db settings.Querier, region ledger.Region, key string) (TierQuote, error) {
	tiers, err := readTiersIn(ctx, db, region)
	if err != nil {
		return TierQuote{}, err
	}
	rate, err := rateInForce(ctx, q, string(region.Currency()))
	if err != nil {
		return TierQuote{}, err
	}
	for _, tier := range tiers {
		if tier.Key == key {
			return quoteAtCost(tier, rate)
		}
	}
	return TierQuote{}, fmt.Errorf("%w: %q in %s", ErrUnknownTier, key, region)
}

// QuoteAtCost is QuoteAtCostIn on the engine's pool.
func (e *Engine) QuoteAtCost(ctx context.Context, region ledger.Region, key string) (TierQuote, error) {
	return QuoteAtCostIn(ctx, sqlcgen.New(e.pool), e.pool, region, key)
}

// AtCostTiers prices every tier size at cost, smallest first as stored.
func (e *Engine) AtCostTiers(ctx context.Context, region ledger.Region) ([]TierQuote, error) {
	tiers, err := readTiersIn(ctx, e.pool, region)
	if err != nil {
		return nil, err
	}
	rate, err := rateInForce(ctx, sqlcgen.New(e.pool), string(region.Currency()))
	if err != nil {
		return nil, err
	}
	quotes := make([]TierQuote, 0, len(tiers))
	for _, tier := range tiers {
		quote, err := quoteAtCost(tier, rate)
		if err != nil {
			return nil, err
		}
		quotes = append(quotes, quote)
	}
	return quotes, nil
}
