package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
)

// ledger-internal's pricing group. No response carries the backing rate B:
// whoever holds B can compute a points price themselves (YT-0130).

type quoteBody struct {
	Region          string `json:"region"`
	Currency        string `json:"currency"`
	SettlementMinor int64  `json:"settlementMinor"`
	// At is accepted only as "now": a quote is priced at the ledger's clock
	// and never at a caller's instant (EM-19).
	At string `json:"at,omitempty"`
}

type quoteView struct {
	QuoteID             string `json:"quoteId"`
	PricePoints         int64  `json:"pricePoints"`
	SettlementMinor     int64  `json:"settlementMinor"`
	Currency            string `json:"currency"`
	BackingRateID       string `json:"backingRateId"`
	DemandMultiplierBps int32  `json:"demandMultiplierBps"`
	ExpiresAt           string `json:"expiresAt"`
	Locked              bool   `json:"locked"`
}

func toQuoteView(q pricing.StoredQuote) quoteView {
	return quoteView{QuoteID: q.ID, PricePoints: q.PricePoints, SettlementMinor: q.SettlementMinor,
		Currency: q.Currency, BackingRateID: q.BackingRateID, DemandMultiplierBps: pricing.NeutralDemandBps,
		ExpiresAt: iso(q.ExpiresAt), Locked: q.Locked}
}

func (a *API) quote(w http.ResponseWriter, r *http.Request) {
	var body quoteBody
	if !a.decode(w, r, &body) {
		return
	}
	if _, _, ok := a.engineFor(w, body.Region); !ok {
		return
	}
	if body.At != "" {
		at, err := time.Parse(time.RFC3339, body.At)
		if err != nil || time.Since(at).Abs() > time.Minute {
			httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "priced_now",
				"a quote is priced now; `at` may only be the present")
			return
		}
	}
	stored, err := a.pricing.NewQuote(r.Context(), ledger.Region(body.Region), body.Currency, body.SettlementMinor)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, toQuoteView(stored))
}

func (a *API) lockQuote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		QuoteID string `json:"quoteId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	locked, err := a.pricing.LockQuote(r.Context(), body.QuoteID)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, toQuoteView(locked))
}

func (a *API) priceListing(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ListingID       string `json:"listingId"`
		Region          string `json:"region"`
		Currency        string `json:"currency"`
		SettlementMinor int64  `json:"settlementMinor"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if _, _, ok := a.engineFor(w, body.Region); !ok {
		return
	}
	price, err := a.pricing.PriceListing(r.Context(), body.ListingID, ledger.Region(body.Region), body.Currency, body.SettlementMinor)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"pricePoints": price.PricePoints, "backingRateId": price.BackingRateID,
	})
}

func (a *API) quotePurchase(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Points int64  `json:"points"`
		Region string `json:"region"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	_, region, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	quoted, err := a.pricing.QuotePurchase(r.Context(), region, body.Points)
	if err != nil {
		a.fail(w, fmt.Errorf("%w: %w", errBadRequest, err))
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"totalMinor": quoted.AmountMinor, "currency": quoted.Currency,
	})
}
