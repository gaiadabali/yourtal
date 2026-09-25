// Package api is the ledger's HTTP surface: packages/contracts'
// ledger-internal contract, over signed loopback calls from apps/api and
// apps/worker (serviceauth wraps every route). Handlers decode, call an
// engine and encode; no business rule lives here.
//
// Every route is a POST with a JSON body, as HttpLedgerClient sends them.
// Money is a JSON number of minor units or points: the contract caps both
// well below 2^53, so a JSON number is exact. A refusal the contract names
// answers {"code", "message"} with the closed ledger-error code; anything
// else answers the httpx error shape.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/burn"
	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
)

// API holds the engines. One reward engine per region: AU and ID never share
// an account or a transfer.
type API struct {
	logger  *slog.Logger
	pool    *pgxpool.Pool
	ledger  *ledger.Ledger
	pricing *pricing.Engine
	rewards map[ledger.Region]*reward.Engine
	burns   *burn.Engine
}

// New wires the engines. attestationSecret verifies apps/api's completion
// attestations (4.4.c); without one, no campaign reward can be paid.
func New(logger *slog.Logger, pool *pgxpool.Pool, attestationSecret []byte) *API {
	book := ledger.New(pool)
	return &API{
		logger: logger, pool: pool, ledger: book, pricing: pricing.New(pool), burns: burn.New(pool, book),
		rewards: map[ledger.Region]*reward.Engine{
			ledger.RegionAU: reward.New(pool, book, reward.AlwaysAllow{}, ledger.RegionAU).WithAttestationSecret(attestationSecret),
			ledger.RegionID: reward.New(pool, book, reward.AlwaysAllow{}, ledger.RegionID).WithAttestationSecret(attestationSecret),
		},
	}
}

// Routes is the contract's paths, as HttpLedgerClient calls them. main.go
// mounts it at /v1 behind serviceauth.
func (a *API) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/pricing/quote", a.quote)
	r.Post("/pricing/quote/lock", a.lockQuote)
	r.Post("/pricing/listing", a.priceListing)
	r.Post("/pricing/purchase-quote", a.quotePurchase)

	r.Post("/allocations/purchase", a.purchasePoints)
	r.Post("/allocations/list", a.listAllocations)
	r.Post("/allocations/get", a.getAllocation)
	r.Post("/allocations/hold", a.hold)
	r.Post("/allocations/hold/consume", a.consume)
	r.Post("/allocations/hold/release", a.release)
	r.Post("/grants/return", a.returnGrant)
	r.Post("/campaigns/spend", a.campaignSpend)

	r.Post("/rewards/grants", a.grantReward)
	r.Post("/actions/grants", a.grantAction)
	r.Post("/burns", a.burnForVoucher)
	r.Post("/burns/get", a.getBurn)
	r.Post("/burns/reinstate", a.reinstateBurn)
	r.Post("/releases/unnotified", a.unnotifiedReleases)
	r.Post("/releases/notified", a.releasesNotified)

	r.Post("/wallet/balance", a.balance)
	r.Post("/wallet/history", a.history)

	r.Post("/economy/coverage", a.coverage)
	r.Post("/economy/daily", a.economyDaily)
	r.Post("/economy/rates/propose", a.proposeRate)
	r.Post("/economy/rates/approve", a.approveRate)
	r.Post("/economy/marketing/fund", a.fundMarketing)

	// Not the ledger's yet: escrow waits for its task, statements and
	// payouts for 10.1. Settings are
	// apps/api's own store (1.2.f); the ledger only reads them.
	for _, path := range []string{"/escrow", "/escrow/release", "/economy/statements",
		"/economy/payouts/approve", "/settings/list", "/settings/propose", "/settings/approve"} {
		r.Post(path, a.notImplemented)
	}
	return r
}

func (a *API) notImplemented(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteError(w, a.logger, http.StatusNotImplemented, "api_error", "not_implemented",
		"not implemented: this ledger-internal operation is not served by the ledger yet")
}

// decode reads a JSON body into dst, refusing unknown fields so a caller's
// typo is an error rather than a silently ignored input.
func (a *API) decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_json", err.Error())
		return false
	}
	return true
}

func (a *API) engineFor(w http.ResponseWriter, value string) (*reward.Engine, ledger.Region, bool) {
	region := ledger.Region(value)
	engine, ok := a.rewards[region]
	if !ok {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "unknown_region",
			"region must be AU or ID")
	}
	return engine, region, ok
}

// contractCodes maps engine refusals to the closed ledger-error enum.
var contractCodes = []struct {
	err  error
	code string
}{
	{ledger.ErrInsufficientFunds, "insufficient_available"},
	{pricing.ErrQuoteExpired, "quote_expired"},
	{reward.ErrAllocationExhausted, "allocation_exhausted"},
	{reward.ErrOverCampaignMax, "campaign_cap_reached"},
	{reward.ErrUserCapReached, "velocity_capped"},
	{reward.ErrDeviceCapReached, "velocity_capped"},
	{reward.ErrIPCapReached, "velocity_capped"},
	{reward.ErrEarnCapReached, "velocity_capped"},
	{reward.ErrSolvencyBlocked, "solvency_blocked"},
	{reward.ErrRegionMismatch, "region_mismatch"},
	{burn.ErrRegionMismatch, "region_mismatch"},
	{burn.ErrPriceNotHeld, "quote_expired"},
	{pricing.ErrRegionMismatch, "region_mismatch"},
	{reward.ErrAlreadyGranted, "already_granted"},
	{ledger.ErrIdempotencyConflict, "idempotency_conflict"},
	{ledger.ErrMixedCurrency, "currency_mismatch"},
	// An unknown quote is answered like an expired one: either way the
	// caller's next step is a fresh quote.
	{pricing.ErrQuoteNotFound, "quote_expired"},
	// The closed enum has no two-person code; the contract answers a
	// self-approval with already_granted, as its fake does.
	{pricing.ErrSameApprover, "already_granted"},
	{reward.ErrSameApprover, "already_granted"},
	{pricing.ErrCurrencyMismatch, "currency_mismatch"},
}

// fail answers an engine error: a contract code as 409, a missing thing as
// 404, a refused input as 400, and anything else as a logged 500.
func (a *API) fail(w http.ResponseWriter, err error) {
	for _, known := range contractCodes {
		if errors.Is(err, known.err) {
			httpx.WriteJSON(w, a.logger, http.StatusConflict, map[string]string{"code": known.code, "message": err.Error()})
			return
		}
	}
	switch {
	case errors.Is(err, pricing.ErrQuoteNotFound), errors.Is(err, burn.ErrNotFound),
		errors.Is(err, burn.ErrListingNotPriced), errors.Is(err, errNotFound):
		httpx.WriteError(w, a.logger, http.StatusNotFound, "invalid_request_error", "not_found", err.Error())
	case errors.Is(err, pricing.ErrNotAPack), errors.Is(err, pricing.ErrNoRateInForce),
		errors.Is(err, pricing.ErrMarginTooThin), errors.Is(err, pricing.ErrSameApprover),
		errors.Is(err, pricing.ErrRateCutTooSoon), errors.Is(err, reward.ErrSameApprover),
		errors.Is(err, reward.ErrUnderpriced), errors.Is(err, reward.ErrWrongFunder),
		errors.Is(err, reward.ErrUnknownAction), errors.Is(err, reward.ErrAttestation),
		errors.Is(err, reward.ErrCampaignNotLive), errors.Is(err, reward.ErrPointsMismatch),
		errors.Is(err, errBadRequest):
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "refused", err.Error())
	default:
		a.logger.Error("ledger request failed", "error", err)
		httpx.WriteError(w, a.logger, http.StatusInternalServerError, "api_error", "internal_error", "something went wrong")
	}
}

var (
	errNotFound   = errors.New("not found")
	errBadRequest = errors.New("bad request")
)

func iso(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
