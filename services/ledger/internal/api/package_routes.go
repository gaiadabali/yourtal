package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/pricing"
)

// Point packages (F122): the region's tiers priced by the ledger. Never B:
// only each tier's price, its undiscounted price and its discount.

func tierQuoteView(quote pricing.TierQuote) map[string]any {
	return map[string]any{
		"tierKey": quote.Key, "points": quote.Points, "discountBps": quote.DiscountBps,
		"totalMinor": quote.AmountMinor, "undiscountedMinor": quote.UndiscountedMinor,
		"currency": quote.Currency,
	}
}

func (a *API) packageTiers(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Region string `json:"region"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	_, region, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	quotes, err := a.pricing.PackageTiers(r.Context(), region)
	if err != nil {
		a.fail(w, fmt.Errorf("%w: %w", errBadRequest, err))
		return
	}
	views := make([]map[string]any, 0, len(quotes))
	for _, quote := range quotes {
		views = append(views, tierQuoteView(quote))
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, views)
}

func (a *API) quotePackage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Region  string `json:"region"`
		TierKey string `json:"tierKey"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	_, region, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	quote, err := a.pricing.QuoteTier(r.Context(), region, body.TierKey)
	if err != nil {
		a.fail(w, fmt.Errorf("%w: %w", errBadRequest, err))
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, tierQuoteView(quote))
}

// checkPackageTiers answers whether a proposed catalogue may be stored or
// approved: 200 when it may, 400 refused with the reason when it may not.
func (a *API) checkPackageTiers(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Region string          `json:"region"`
		Tiers  json.RawMessage `json:"tiers"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	_, region, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	if err := a.pricing.CheckTiers(r.Context(), region, body.Tiers); err != nil {
		a.fail(w, fmt.Errorf("%w: %w", errBadRequest, err))
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"ok": true})
}
