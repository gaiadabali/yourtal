package redeem

import (
	"log/slog"
	"net/http"

	"github.com/yourtal/services/voucher/internal/httpx"
)

// void and refund, split from routes.go for the same reason release.go is
// split from settle.go: everything here releases or restores rather than
// commits.

type voidBody struct {
	AuthorizationID string `json:"authorization_id"`
}

type voidResponse struct {
	AuthorizationID string `json:"authorization_id"`
	Voided          bool   `json:"voided"`
}

func voidHandler(logger *slog.Logger, network *Network) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
}

type refundResponse struct {
	ReceiptID string `json:"receipt_id"`
	Refunded  bool   `json:"refunded"`
}

func refundHandler(logger *slog.Logger, network *Network) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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

		if err := network.Refund(r.Context(), captureID, body.Amount, body.Reason); err != nil {
			writeRefundError(w, logger, err)
			return
		}

		httpx.WriteJSON(w, logger, http.StatusOK, refundResponse{
			ReceiptID: body.ReceiptID,
			Refunded:  true,
		})
	}
}
