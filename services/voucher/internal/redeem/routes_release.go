package redeem

import (
	"log/slog"
	"net/http"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/merchantauth"
)

// void and refund, split from routes.go for the same reason release.go is
// split from settle.go: everything here releases or restores rather than
// commits.

// refuseDevicePrincipal is 4.5.c: a device-scoped credential (every one
// issued through the internal API, 4.5.d) may authorize and capture, but
// void and refund need a stronger principal — a legacy merchant-wide key.
// Refused before any lookup, the same "cheap refusals first" ordering
// Authorize already uses for the kill switch and the throttle.
func refuseDevicePrincipal(w http.ResponseWriter, logger *slog.Logger, r *http.Request) bool {
	if deviceID, isDevice := merchantauth.DeviceID(r.Context()); isDevice {
		logger.Warn("device principal refused on void/refund", "device_id", deviceID)
		httpx.WriteError(w, logger, http.StatusForbidden,
			"permission_error", "device_principal_refused",
			"a device credential cannot void or refund; use a merchant-wide credential")
		return true
	}
	return false
}

type voidBody struct {
	AuthorizationID string `json:"authorization_id"`
}

type voidResponse struct {
	AuthorizationID string `json:"authorization_id"`
	Voided          bool   `json:"voided"`
}

func voidHandler(logger *slog.Logger, network *Network) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if refuseDevicePrincipal(w, logger, r) {
			return
		}
		var body voidBody
		if !decodeJSON(w, logger, r, &body) {
			return
		}
		merchantID, ok := requireMerchant(w, logger, r)
		if !ok {
			return
		}

		authorizationID, err := parseUUID(body.AuthorizationID)
		if err != nil {
			writeVoidError(w, logger, ErrNoLiveHold)
			return
		}
		if err := network.requireOwnedAuthorization(r.Context(), authorizationID, merchantID); err != nil {
			writeVoidError(w, logger, err)
			return
		}

		if err := network.Void(r.Context(), authorizationID, merchantID); err != nil {
			writeVoidError(w, logger, err)
			return
		}

		httpx.WriteJSON(w, logger, http.StatusOK, voidResponse{
			AuthorizationID: authorizationID.String(),
			Voided:          true,
		})
	}
}

type refundBody struct {
	ReceiptID string `json:"receipt_id"`
	Amount    int64  `json:"amount"`
	Reason    string `json:"reason"`
	// RefundRef is the merchant's reference for this refund, once per receipt.
	RefundRef string `json:"refund_ref"`
}

type refundResponse struct {
	ReceiptID string `json:"receipt_id"`
	Refunded  bool   `json:"refunded"`
}

func refundHandler(logger *slog.Logger, network *Network) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if refuseDevicePrincipal(w, logger, r) {
			return
		}
		var body refundBody
		if !decodeJSON(w, logger, r, &body) {
			return
		}
		merchantID, ok := requireMerchant(w, logger, r)
		if !ok {
			return
		}

		captureID, err := network.captureForReceipt(r.Context(), body.ReceiptID, merchantID)
		if err != nil {
			writeRefundError(w, logger, err)
			return
		}

		if err := network.Refund(r.Context(), captureID, body.Amount, body.Reason, body.RefundRef); err != nil {
			writeRefundError(w, logger, err)
			return
		}

		httpx.WriteJSON(w, logger, http.StatusOK, refundResponse{
			ReceiptID: body.ReceiptID,
			Refunded:  true,
		})
	}
}
