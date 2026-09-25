// Package api is the voucher-internal HTTP surface: packages/contracts'
// voucher-internal contract, over signed loopback calls from apps/api
// (services/voucher/internal/serviceauth wraps every route). Handlers
// decode, call an engine (issue.Minter, redeem.Network) and encode; no
// business rule lives here.
//
// Mounted at /internal/v1, a SEPARATE route group from /v1/vouchers — the
// merchant redemption network, which stays behind merchantauth. TASKS.md
// 4.5: "merchant-facing routes keep merchantauth; the internal routes use
// serviceauth. Keep them on separate route groups."
//
// Every route is a POST with a JSON body, mirroring the ledger's
// internal/api. A refusal the contract names answers {"code","message"}
// with the closed ledger-error code (VoucherError = LedgerError, 1.2.c);
// anything else answers the httpx error shape.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/redeem"
)

// API holds the engines this surface calls into.
type API struct {
	logger  *slog.Logger
	pool    *pgxpool.Pool
	minter  *issue.Minter
	network *redeem.Network
	keys    *keyring.Keyring
}

func New(logger *slog.Logger, pool *pgxpool.Pool, minter *issue.Minter, network *redeem.Network, keys *keyring.Keyring) *API {
	return &API{logger: logger, pool: pool, minter: minter, network: network, keys: keys}
}

// Routes is the contract's paths, as HttpVoucherClient (4.5) calls them.
// cmd/voucher mounts it at /internal/v1 behind serviceauth.
func (a *API) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/batches", a.requestBatch)
	r.Post("/batches/approve", a.approveBatch)

	r.Post("/reservations", a.reserve)
	r.Post("/reservations/release", a.release)
	r.Post("/reservations/activate", a.activate)

	r.Post("/vouchers/reveal", a.reveal)
	r.Post("/vouchers/void", a.voidVoucher)
	r.Post("/vouchers/qr-token", a.qrToken)
	r.Post("/vouchers/qr-token/verify", a.verifyQrToken)

	r.Post("/wallet/list", a.listForUser)
	r.Post("/wallet/get", a.get)

	r.Post("/device/authorize", a.authorizeAsDevice)
	r.Post("/device/capture", a.captureAsDevice)

	r.Post("/kill-switches", a.setKillSwitch)
	r.Post("/kill-switches/list", a.listKillSwitches)

	r.Post("/credentials", a.issueMerchantCredential)
	r.Post("/credentials/rotate", a.rotateCredential)
	r.Post("/credentials/revoke", a.revokeCredential)

	r.Post("/merchants/capture-stats", a.merchantCaptureStats)

	return r
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

// contractCodes maps engine refusals to the closed ledger-error enum
// (VoucherError = LedgerError). Handlers that need a code this table does
// not have write it directly rather than stretching one of these to fit.
var contractCodes = []struct {
	err  error
	code string
}{
	{issue.ErrSelfApproval, "already_granted"},
	{redeem.ErrKilled, "kill_switch"},
	{redeem.ErrThrottled, "velocity_capped"},
	{redeem.ErrCurrencyMismatch, "currency_mismatch"},
	{errAudienceBlocked, "audience_blocked"},
	{errAlreadyCaptured, "already_granted"},
	{errAuthorizationExpired, "quote_expired"},
	{errRegionMismatch, "region_mismatch"},
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
	case errors.Is(err, issue.ErrNotFound), errors.Is(err, pgx.ErrNoRows), errors.Is(err, errNotFound):
		httpx.WriteError(w, a.logger, http.StatusNotFound, "invalid_request_error", "not_found", err.Error())
	case errors.Is(err, issue.ErrStaleVersion), errors.Is(err, lifecycle.ErrIllegalTransition):
		httpx.WriteError(w, a.logger, http.StatusConflict, "api_error", "retry", "the voucher changed under this request; retry")
	case errors.Is(err, issue.ErrWrongSupplier), errors.Is(err, issue.ErrOutOfStock), errors.Is(err, errBadRequest):
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "refused", err.Error())
	default:
		a.logger.Error("voucher-internal request failed", "error", err)
		httpx.WriteError(w, a.logger, http.StatusInternalServerError, "api_error", "internal_error", "something went wrong")
	}
}

var (
	errNotFound             = errors.New("api: not found")
	errBadRequest           = errors.New("api: bad request")
	errAudienceBlocked      = errors.New("api: this caller does not hold this voucher")
	errAlreadyCaptured      = errors.New("api: already captured")
	errAuthorizationExpired = errors.New("api: this authorization has expired")
	errRegionMismatch       = errors.New("api: the merchant's region does not match this voucher's")
)

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func asUUID(value pgtype.UUID) uuid.UUID { return value.Bytes }

func iso(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
