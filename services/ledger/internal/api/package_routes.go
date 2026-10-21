package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
)

// Point packages (F122): the region's tiers priced by the ledger. Never B:
// only each tier's price, its undiscounted price and its discount. A receipt
// package (F127) is quoted at cost to its funder, so its price shows B times
// the points; no field carries the rate itself.

const (
	pricingTier   = "tier"
	pricingAtCost = "at_cost"
)

func tierQuoteView(quote pricing.TierQuote, pricedAs string) map[string]any {
	return map[string]any{
		"tierKey": quote.Key, "points": quote.Points, "discountBps": quote.DiscountBps,
		"totalMinor": quote.AmountMinor, "undiscountedMinor": quote.UndiscountedMinor,
		"currency": quote.Currency, "pricing": pricedAs,
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
		views = append(views, tierQuoteView(quote, pricingTier))
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, views)
}

// receiptPackageTiers is every tier size at cost, for the region's receipt
// funder only: any other business is refused.
func (a *API) receiptPackageTiers(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Region     string `json:"region"`
		BusinessID string `json:"businessId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	engine, _, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	quotes, err := engine.ReceiptPackageTiers(r.Context(), body.BusinessID)
	if err != nil {
		a.fail(w, fmt.Errorf("%w: %w", errBadRequest, err))
		return
	}
	views := make([]map[string]any, 0, len(quotes))
	for _, quote := range quotes {
		views = append(views, tierQuoteView(quote, pricingAtCost))
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, views)
}

// quotePackage prices one tier; with programme "receipts" and the funder's
// businessId (both or neither), at cost.
func (a *API) quotePackage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Region     string `json:"region"`
		TierKey    string `json:"tierKey"`
		Programme  string `json:"programme,omitempty"`
		BusinessID string `json:"businessId,omitempty"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	engine, region, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	if (body.Programme == "") != (body.BusinessID == "") {
		a.fail(w, fmt.Errorf("%w: send programme and businessId together, or neither", errBadRequest))
		return
	}
	var quote pricing.TierQuote
	var err error
	pricedAs := pricingTier
	switch body.Programme {
	case "":
		quote, err = a.pricing.QuoteTier(r.Context(), region, body.TierKey)
	case reward.ProgrammeReceipts:
		quote, err = engine.QuoteReceiptPackage(r.Context(), body.BusinessID, body.TierKey)
		pricedAs = pricingAtCost
	default:
		err = fmt.Errorf("%w: %q", reward.ErrUnknownProgramme, body.Programme)
	}
	if err != nil {
		a.fail(w, fmt.Errorf("%w: %w", errBadRequest, err))
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, tierQuoteView(quote, pricedAs))
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
