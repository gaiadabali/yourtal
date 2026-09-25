package pricing

import (
	"context"
	"fmt"

	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// repriceBatch bounds one read of stale listings.
const repriceBatch = 500

// RepriceListings recomputes every listing priced at a rate that is no
// longer in force (4.9.a), with PriceListing's own formula. Idempotent: a
// listing already at the rate in force is not read, and a listing whose S
// changed meanwhile is left to the priceListing that changed it.
func (e *Engine) RepriceListings(ctx context.Context) (int, error) {
	q := sqlcgen.New(e.pool)
	repriced := 0
	for {
		stale, err := q.ListStaleListingPrices(ctx, repriceBatch)
		if err != nil {
			return repriced, fmt.Errorf("reading stale listing prices: %w", err)
		}
		rates := map[string]sqlcgen.GetBackingRateInForceRow{}
		moved := 0
		for _, row := range stale {
			rate, ok := rates[row.Currency]
			if !ok {
				if rate, err = rateInForce(ctx, q, row.Currency); err != nil {
					return repriced, err
				}
				rates[row.Currency] = rate
			}
			points, rateID, err := priceAt(rate, row.SettlementMinor)
			if err != nil {
				return repriced, fmt.Errorf("repricing listing %s: %w", uuidString(row.ListingID), err)
			}
			n, err := q.RepriceListing(ctx, sqlcgen.RepriceListingParams{
				PricePoints: points, RateID: rateID, ListingID: row.ListingID,
				SettlementMinor: row.SettlementMinor, PricedRateID: row.BackingRateID,
			})
			if err != nil {
				return repriced, fmt.Errorf("repricing listing %s: %w", uuidString(row.ListingID), err)
			}
			moved += int(n)
		}
		repriced += moved
		// A short batch was the last; a batch where nothing moved means the
		// rest raced with priceListing and would loop forever.
		if len(stale) < repriceBatch || moved == 0 {
			return repriced, nil
		}
	}
}
