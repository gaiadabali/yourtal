// Package api is the ledger's HTTP surface: it decodes a request, calls the
// internal/ledger, internal/reward or internal/pricing library the request
// names, and encodes the result. docs/13a §7: handlers are thin, business
// logic never lives here.
//
// # Money on the wire
//
// Every minor-unit amount (points, IDR, AUD) is a JSON STRING of a decimal
// integer, never a JSON number. A JSON number is a float64 in every client
// this API will ever have, and float64 loses precision above 2^53 — a value
// this ledger can reach once points and IDR amounts are in the same range. A
// price quote of "1999.9999999999998" is not a rounding curiosity here, it
// is a different amount of money than the database holds. Small bounded
// integers that are never arithmetic (basis points, a rate row's id) stay
// JSON numbers or strings as suits them; anything that is an amount of
// currency or points goes through moneyString / parseMoney below, with no
// exception.
//
// # What unit these amounts are in
//
// This package does not know, and does not decide. FOUNDER DECISION T-1
// settled that IDR is stored in whole Rupiah (exponent 0), and the migration
// dividing already-stored values by 100 has run — but nothing here hardcodes
// that or any other scale factor. An amount arriving over this API is passed
// to internal/ledger and internal/pricing exactly as given, in whatever
// minor unit the caller and the current contents of the database already
// agree on. That is the same ignorance internal/ledger's own package comment
// describes ("it never needs to know what the integer MEANS") extended one
// layer out, not a new assumption.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
)

// API holds the dependencies every handler needs. Constructed once in main
// and injected, per docs/13a §5 — nothing below reaches for a global.
type API struct {
	logger  *slog.Logger
	ledger  *ledger.Ledger
	pricing *pricing.Engine
}

func New(logger *slog.Logger, book *ledger.Ledger, priced *pricing.Engine) *API {
	return &API{logger: logger, ledger: book, pricing: priced}
}

// Routes returns the mountable router. main.go mounts it at /v1 after the
// fixed middleware prefix (RequestID -> ClientIP -> Recoverer -> Timeout);
// auth, Cerbos and idempotency are not yet in that chain, so every route
// below is a 501 naming that gap. None of the four is live.
//
// # Every route is gated, including the reads
//
// An earlier version of this file drew the line at "does this write a row
// or move a balance", and left the balance read and the price quote open on
// that basis. That line is right for WRITE risk and wrong for READ risk,
// and this codebase had already reasoned that through one layer down:
// YT-0150 on services/voucher is "no bare balance endpoint", because a
// caller who can query a balance keyed by account id can binary-search it —
// which is exactly why unknown-code, wrong-merchant and insufficient-value
// all return one identical error there. GET /accounts/{id}/balance, open,
// is that same enumeration surface for this ledger. It is gated for the
// same reason the voucher service already gates its lookups, not a new one.
func (a *API) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/accounts/{accountID}/balance", a.notYetExposed(
		"the balance API is implemented but not yet exposed: it is waiting on caller "+
			"authentication. An account-id-keyed balance read with no caller check is a "+
			"binary-search enumeration surface (services/voucher's YT-0150 draws the same "+
			"line: 'no bare balance endpoint'), not a harmless read just because it writes "+
			"nothing"))
	r.Post("/pricing/quote", a.notYetExposed(
		"the pricing quote API is implemented but not yet exposed: it is waiting on caller "+
			"authentication. This is not only about who may ask — the backing rate B lives in "+
			"the ledger schema specifically so a supplier cannot compute a points price "+
			"themselves (YT-0130, enforced by GRANT: yourtal_app has no access to schema "+
			"ledger at all), and this response never returns B even to an authenticated "+
			"caller for the same reason"))

	// --- not yet exposed: these write to the ledger. Following the pattern
	// services/voucher/cmd/voucher/main.go already set for exactly this
	// situation (notYetExposed) rather than inventing a second one.
	r.Post("/transfers", a.notYetExposed(
		"the transfer API is implemented but not yet exposed: it is waiting on caller "+
			"authentication and the shared idempotency interceptor, both of which docs/13a "+
			"section 7 requires IN FRONT of a money-moving handler. Serving it unauthenticated "+
			"would let any caller move balances between arbitrary accounts"))
	r.Post("/rewards/grants", a.notYetExposed(
		"the reward grant API is implemented but not yet exposed: it is waiting on caller "+
			"authentication and the shared idempotency interceptor (docs/13a section 7), and on "+
			"a real risk gate to replace reward.AlwaysAllow. Serving it unauthenticated would let "+
			"any caller mint points against a funding allocation directly"))

	return r
}

// notYetExposed mirrors services/voucher/cmd/voucher/main.go's handler of the
// same name and for the same reason: an honest 501 that names its blocker,
// rather than a route silently missing or — worse — silently open.
func (a *API) notYetExposed(reason string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteError(w, a.logger, http.StatusNotImplemented,
			"api_error", "not_exposed", reason)
	}
}

// --- balance ----------------------------------------------------------

type balanceResponse struct {
	AccountID string `json:"account_id"`
	// BalanceMinor is a decimal-integer STRING; see the package comment.
	BalanceMinor string `json:"balance_minor"`
}

// getBalance projects a balance. ledger.Balance is a SUM over entries with no
// stored row to be missing, so an account nobody ever posted to reads back
// as zero rather than 404 — that is a property of the projection, not a
// decision this handler makes.
func (a *API) getBalance(w http.ResponseWriter, r *http.Request) {
	accountID := chi.URLParam(r, "accountID")
	if accountID == "" {
		httpx.WriteError(w, a.logger, http.StatusBadRequest,
			"invalid_request_error", "missing_account_id", "an account id is required")
		return
	}

	balance, err := a.ledger.Balance(r.Context(), accountID)
	if err != nil {
		a.logger.Error("balance lookup failed", "account_id", accountID, "error", err)
		httpx.WriteError(w, a.logger, http.StatusInternalServerError,
			"api_error", "balance_lookup_failed", "could not project this account's balance")
		return
	}

	httpx.WriteJSON(w, a.logger, http.StatusOK, balanceResponse{
		AccountID:    accountID,
		BalanceMinor: moneyString(balance),
	})
}

// --- pricing quote ------------------------------------------------------

type quoteRequest struct {
	Currency string `json:"currency"`
	// SettlementMinor is S, the supplier's declared settlement value, as a
	// decimal-integer string; see the package comment.
	SettlementMinor string `json:"settlement_minor"`
	// At is optional, RFC3339. Empty means "now". Exists so a caller can
	// price against a specific instant for reconciliation; it is NOT how a
	// caller backdates a quote to dodge a rate change — RateAt only ever
	// returns the rate that was actually in force at that instant.
	At string `json:"at,omitempty"`
}

// quoteResponse deliberately does NOT carry BackingMicrosPerPoint (B).
//
// infra/postgres/init/01-schemas.sql revokes yourtal_app's access to the
// `ledger` schema entirely, specifically so the store service cannot
// compute a points price itself — YT-0130: "a supplier can never set a
// points price directly, now true by GRANT rather than by convention." An
// endpoint that hands B to any caller who can reach it undoes that by a
// different door: whoever holds B can compute
// `points = ceil(S × B⁻¹ × multiplier)` themselves, which makes the GRANT
// boundary decorative for every caller of THIS service, authenticated or
// not. The store needs the computed price. It does not need the input that
// produced it, and this type does not offer it a way to ask.
//
// BackingRateID stays: it is an opaque identifier for audit correlation
// ("which rate produced this price"), not the rate's value, and nothing in
// this package resolves it back to one over this route. If a future
// endpoint ever needs to resolve a BackingRateID to its MicrosPerPoint,
// that endpoint needs its own authorization decision — it does not inherit
// this one's.
type quoteResponse struct {
	PricePoints         string `json:"price_points"`
	SettlementMinor     string `json:"settlement_minor"`
	BackingRateID       string `json:"backing_rate_id"`
	DemandMultiplierBps int32  `json:"demand_multiplier_bps"`
}

// postPricingQuote computes a price. It never writes anything, and never
// returns B — see quoteResponse's comment. It is not currently reachable;
// see Routes.
func (a *API) postPricingQuote(w http.ResponseWriter, r *http.Request) {
	var req quoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest,
			"invalid_request_error", "malformed_json", "the request body is not valid JSON")
		return
	}

	if req.Currency == "" {
		httpx.WriteError(w, a.logger, http.StatusBadRequest,
			"invalid_request_error", "missing_currency", "currency is required")
		return
	}

	settlementMinor, err := parseMoney(req.SettlementMinor)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest,
			"invalid_request_error", "invalid_settlement_minor", err.Error())
		return
	}

	at := time.Now().UTC()
	if req.At != "" {
		parsed, err := time.Parse(time.RFC3339, req.At)
		if err != nil {
			httpx.WriteError(w, a.logger, http.StatusBadRequest,
				"invalid_request_error", "invalid_at", "at must be RFC3339")
			return
		}
		at = parsed
	}

	quote, err := a.pricing.Quote(r.Context(), req.Currency, settlementMinor, at)
	if err != nil {
		a.writeQuoteError(w, err)
		return
	}

	httpx.WriteJSON(w, a.logger, http.StatusOK, quoteResponse{
		PricePoints:         moneyString(quote.PricePoints),
		SettlementMinor:     moneyString(quote.SettlementMinor),
		BackingRateID:       quote.BackingRateID,
		DemandMultiplierBps: quote.DemandMultiplierBps,
	})
}

// writeQuoteError maps pricing's sentinel errors to the status a caller can
// act on, rather than a flat 500 for everything the package can return.
func (a *API) writeQuoteError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, pricing.ErrNoRateInForce):
		httpx.WriteError(w, a.logger, http.StatusNotFound,
			"invalid_request_error", "no_rate_in_force", err.Error())
	case errors.Is(err, pricing.ErrSettlementNotPositive),
		errors.Is(err, pricing.ErrMultiplierOutOfBounds),
		errors.Is(err, pricing.ErrBackingRateNotPositive):
		httpx.WriteError(w, a.logger, http.StatusBadRequest,
			"invalid_request_error", "invalid_quote_input", err.Error())
	case errors.Is(err, pricing.ErrPriceOutOfRange):
		httpx.WriteError(w, a.logger, http.StatusBadRequest,
			"invalid_request_error", "price_out_of_range", err.Error())
	default:
		a.logger.Error("pricing quote failed", "error", err)
		httpx.WriteError(w, a.logger, http.StatusInternalServerError,
			"api_error", "quote_failed", "could not compute a price for this listing")
	}
}

// --- money helpers --------------------------------------------------------

// moneyString renders a minor-unit amount as a decimal string. See the
// package comment for why this is never a JSON number.
func moneyString(minor int64) string { return strconv.FormatInt(minor, 10) }

// parseMoney is the inverse, with an error a client can act on rather than a
// generic "invalid number".
func parseMoney(s string) (int64, error) {
	if s == "" {
		return 0, errors.New("an amount is required")
	}
	value, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%q is not a decimal integer minor-unit amount: %w", s, err)
	}
	return value, nil
}
