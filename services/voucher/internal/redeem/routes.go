package redeem

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/yourtal/services/voucher/internal/httpx"
)

// Routes is the redemption network's HTTP surface, docs/09 §8.1.
//
// Mounted by cmd/voucher BEHIND merchantauth.Verifier.Middleware and
// idempotency.Interceptor.Middleware, in that order — see the wiring
// comment there for why. Handlers are thin: decode, call Network, encode
// (docs/13a §7); every judgment call about what a failure looks like on the
// wire lives in httpmap.go, not here.
func Routes(logger *slog.Logger, network *Network) chi.Router {
	r := chi.NewRouter()
	r.Post("/authorize", authorizeHandler(logger, network))
	r.Post("/capture", captureHandler(logger, network))
	r.Post("/void", voidHandler(logger, network))
	r.Post("/refund", refundHandler(logger, network))
	return r
}

type authorizeBody struct {
	Code             string `json:"code"`
	Amount           int64  `json:"amount"`
	Currency         string `json:"currency"`
	MerchantOrderRef string `json:"merchant_order_ref"`
	// OrderTotal is the whole basket; a minimum spend applies to it.
	OrderTotal int64 `json:"order_total,omitempty"`
}

type authorizeResponse struct {
	AuthorizationID  string `json:"authorization_id"`
	AmountAuthorized int64  `json:"amount_authorized"`
	RemainingBalance int64  `json:"remaining_balance"`
	ExpiresAt        string `json:"expires_at"`
}

func authorizeHandler(logger *slog.Logger, network *Network) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body authorizeBody
		if !decodeJSON(w, logger, r, &body) {
			return
		}
		merchantID, ok := requireMerchant(w, logger, r)
		if !ok {
			return
		}

		authorization, err := network.Authorize(r.Context(), AuthorizeRequest{
			Code:            body.Code,
			MerchantID:      merchantID,
			AmountMinor:     body.Amount,
			Currency:        body.Currency,
			OrderRef:        body.MerchantOrderRef,
			OrderTotalMinor: body.OrderTotal,
		})
		if err != nil {
			writeAuthorizeError(w, logger, err)
			return
		}

		httpx.WriteJSON(w, logger, http.StatusOK, authorizeResponse{
			AuthorizationID:  authorization.ID.String(),
			AmountAuthorized: authorization.AmountMinor,
			RemainingBalance: authorization.RemainingMinor,
			ExpiresAt:        authorization.ExpiresAt.UTC().Format(time.RFC3339),
		})
	}
}

type captureBody struct {
	AuthorizationID string `json:"authorization_id"`
	FinalAmount     int64  `json:"final_amount"`
}

type captureResponse struct {
	ReceiptID        string `json:"receipt_id"`
	AmountCaptured   int64  `json:"amount_captured"`
	RemainingBalance int64  `json:"remaining_balance"`
}

func captureHandler(logger *slog.Logger, network *Network) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body captureBody
		if !decodeJSON(w, logger, r, &body) {
			return
		}
		merchantID, ok := requireMerchant(w, logger, r)
		if !ok {
			return
		}

		authorizationID, err := parseUUID(body.AuthorizationID)
		if err != nil {
			writeCaptureError(w, logger, ErrNoLiveHold)
			return
		}
		if err := network.requireOwnedAuthorization(r.Context(), authorizationID, merchantID); err != nil {
			writeCaptureError(w, logger, err)
			return
		}

		capture, err := network.Capture(r.Context(), authorizationID, merchantID, body.FinalAmount, receiptID())
		if err != nil {
			writeCaptureError(w, logger, err)
			return
		}

		httpx.WriteJSON(w, logger, http.StatusOK, captureResponse{
			ReceiptID:        capture.ReceiptID,
			AmountCaptured:   capture.AmountMinor,
			RemainingBalance: capture.RemainingMinor,
		})
	}
}
