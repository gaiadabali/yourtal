package redeem

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/merchantauth"
)

// The HTTP boundary. Kept separate from routes.go so the error-mapping
// judgment calls — which sentinel gets which status, and which of them is
// allowed to speak its wrapped detail — sit in one place a reviewer can read
// end to end rather than scattered across four handlers.

func decodeJSON(w http.ResponseWriter, logger *slog.Logger, r *http.Request, dst any) bool {
	defer func() { _ = r.Body.Close() }()
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		httpx.WriteError(w, logger, http.StatusBadRequest,
			"invalid_request_error", "malformed_body", "the request body is not valid JSON")
		return false
	}
	return true
}

// requireMerchant reads the merchant a verified signature was made by.
// docs/13a §7's fixed ordering (auth before idempotency before module) means
// this should never miss in a real deployment — a miss here is a wiring
// defect, not a caller mistake, so it is a 500 rather than a 401.
func requireMerchant(w http.ResponseWriter, logger *slog.Logger, r *http.Request) (uuid.UUID, bool) {
	id, present := merchantauth.MerchantID(r.Context())
	if !present {
		logger.Error("redeem handler ran with no merchant in context; check middleware order")
		internalError(w, logger)
		return uuid.UUID{}, false
	}
	return id, true
}

func internalError(w http.ResponseWriter, logger *slog.Logger) {
	httpx.WriteError(w, logger, http.StatusInternalServerError,
		"api_error", "internal_error", "something went wrong")
}

// parseUUID rejects a malformed id before it reaches a lookup. A syntax
// error is not enumeration-sensitive — it discloses nothing about any real
// id — so callers may report it distinctly, unlike a lookup miss.
func parseUUID(raw string) (uuid.UUID, error) { return uuid.Parse(raw) }

// receiptID mints the identifier a capture is returned under. Server-issued
// rather than caller-supplied: docs/09 §8.1's capture request carries no
// receipt_id, only authorization_id and final_amount, and the receipt is
// what the merchant later gives back on a refund.
func receiptID() string { return "rcpt_" + uuid.New().String() }

// writeAuthorizeError is the one place docs/09 §10's "one refusal, many
// reasons" invariant is enforced at the HTTP boundary.
func writeAuthorizeError(w http.ResponseWriter, logger *slog.Logger, err error) {
	switch {
	case errors.Is(err, ErrKilled):
		// Not an enumeration signal: this discloses the MERCHANT's own
		// operational state, the same fact regardless of which code was
		// tried, so it costs a prober nothing to learn it.
		httpx.WriteError(w, logger, http.StatusForbidden,
			"permission_error", "redemption_disabled", err.Error())
	case errors.Is(err, ErrThrottled):
		httpx.WriteError(w, logger, http.StatusTooManyRequests,
			"rate_limit_error", "too_many_failed_attempts", err.Error())
	case errors.Is(err, ErrBelowMinimumSpend):
		// The one refusal a cashier can act on. redeem's package comment:
		// the customer already knows what is in their basket, so naming the
		// threshold makes the voucher usable rather than insecure.
		httpx.WriteError(w, logger, http.StatusPaymentRequired,
			"card_error", "below_minimum_spend", err.Error())
	case errors.Is(err, ErrDuplicateOrder):
		// About the merchant's OWN order reference, which they chose — not
		// about the voucher, so distinguishing it costs nothing.
		httpx.WriteError(w, logger, http.StatusConflict,
			"invalid_request_error", "duplicate_order", err.Error())
	case errors.Is(err, ErrAlreadyHeld):
		// This fires only after `check()` has already confirmed the code is
		// real, belongs to this merchant, is active and has enough value —
		// it is the `authorization_one_live_hold_per_voucher` partial index
		// losing a race, not a lookup. Disclosing it costs a prober nothing
		// they have not already established, and a till needs to know
		// "try again in a moment" is different from "this will never work".
		httpx.WriteError(w, logger, http.StatusConflict,
			"invalid_request_error", "voucher_already_held", err.Error())
	case errors.Is(err, ErrRefused):
		// Unknown code, wrong merchant, insufficient value, inactive
		// voucher, an un-thresholded policy refusal: one status, one code,
		// one message, always. `err.Error()` is deliberately NOT used —
		// `check()` wraps ErrRefused with extra detail in its currency
		// branch, and passing that through would reopen the exact oracle
		// `voucher.redemption_attempt` exists to keep closed. Only the
		// sentinel's own fixed text ever leaves this branch.
		httpx.WriteError(w, logger, http.StatusPaymentRequired,
			"card_error", "authorization_refused", ErrRefused.Error())
	default:
		logger.Error("authorize failed", "error", err)
		internalError(w, logger)
	}
}

func writeCaptureError(w http.ResponseWriter, logger *slog.Logger, err error) {
	switch {
	case errors.Is(err, ErrNoLiveHold):
		httpx.WriteError(w, logger, http.StatusNotFound,
			"invalid_request_error", "no_live_authorization", err.Error())
	case errors.Is(err, ErrRefused):
		// Not an enumeration surface: the authorization id was already
		// handed to this merchant by a prior successful authorize, so
		// naming the mismatch discloses nothing a prober could use to find
		// a NEW voucher — unlike the same sentinel reached from Authorize.
		httpx.WriteError(w, logger, http.StatusPaymentRequired,
			"invalid_request_error", "capture_exceeds_authorization", err.Error())
	default:
		logger.Error("capture failed", "error", err)
		internalError(w, logger)
	}
}

func writeVoidError(w http.ResponseWriter, logger *slog.Logger, err error) {
	switch {
	case errors.Is(err, ErrNoLiveHold):
		httpx.WriteError(w, logger, http.StatusNotFound,
			"invalid_request_error", "no_live_authorization", err.Error())
	default:
		logger.Error("void failed", "error", err)
		internalError(w, logger)
	}
}

func writeRefundError(w http.ResponseWriter, logger *slog.Logger, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.WriteError(w, logger, http.StatusNotFound,
			"invalid_request_error", "not_found", err.Error())
	case errors.Is(err, ErrRefundNeedsReplacement):
		httpx.WriteError(w, logger, http.StatusConflict,
			"invalid_request_error", "refund_needs_replacement", err.Error())
	case errors.Is(err, ErrRefused):
		httpx.WriteError(w, logger, http.StatusPaymentRequired,
			"invalid_request_error", "refund_exceeds_face_value", err.Error())
	default:
		logger.Error("refund failed", "error", err)
		internalError(w, logger)
	}
}
