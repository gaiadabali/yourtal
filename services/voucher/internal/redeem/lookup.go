package redeem

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 2.8 T3: the merchant's order lookup. A merchant that loses the answer to
// an authorize or a capture cannot learn the outcome from a retry: every
// answer is stored for 24 h and replayed, a key stuck in progress runs again
// after five minutes, and keys expire. A read by merchant_order_ref, the one
// identifier the merchant chose itself, resolves every unknown outcome.
//
// It is a pure read. It never writes a redemption_attempt row, so it can
// never feed the 20-in-5-minutes throttle, and it ignores the kill switch:
// stopping redemption must not stop a till from learning what already
// happened.

// ErrOrderNotFound is an unknown reference, or one that belongs to another
// merchant. The same error for both, as everywhere else in this package.
var ErrOrderNotFound = errors.New("redeem: no order with that reference")

// ErrOrderRefRequired is a missing or blank merchant_order_ref.
var ErrOrderRefRequired = errors.New("redeem: merchant_order_ref is required")

// OrderState is what a merchant sees an order as.
type OrderState string

const (
	OrderHeld     OrderState = "held"
	OrderCaptured OrderState = "captured"
	OrderVoided   OrderState = "voided"
	OrderExpired  OrderState = "expired"
)

// OrderStatus is the answer to a lookup. ReceiptID and AmountCaptured are
// set only for a captured order.
type OrderStatus struct {
	AuthorizationID  uuid.UUID
	State            OrderState
	AmountAuthorized int64
	ExpiresAt        time.Time
	ReceiptID        string
	AmountCaptured   *int64
}

// LookupOrder reads a merchant's own order by reference. A hold past its
// expires_at reads as expired even before the sweep, the same rule capture
// and void already apply at the moment of use.
func (n *Network) LookupOrder(ctx context.Context, merchantID uuid.UUID, orderRef string) (OrderStatus, error) {
	orderRef = strings.TrimSpace(orderRef)
	if orderRef == "" {
		return OrderStatus{}, ErrOrderRefRequired
	}

	row, err := sqlcgen.New(n.pool).LookupOrderForMerchant(ctx, sqlcgen.LookupOrderForMerchantParams{
		MerchantID: pgUUID(merchantID), MerchantOrderRef: orderRef,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return OrderStatus{}, fmt.Errorf("%w: %s", ErrOrderNotFound, orderRef)
	}
	if err != nil {
		return OrderStatus{}, fmt.Errorf("looking up the order: %w", err)
	}

	status := OrderStatus{
		AuthorizationID:  asUUID(row.ID),
		State:            OrderState(row.State),
		AmountAuthorized: row.AmountMinor,
		ExpiresAt:        row.ExpiresAt.Time,
	}
	if status.State == OrderCaptured && row.ReceiptID != nil {
		status.ReceiptID = *row.ReceiptID
		status.AmountCaptured = row.CapturedMinor
	}
	return status, nil
}

type lookupBody struct {
	MerchantOrderRef string `json:"merchant_order_ref"`
}

type lookupResponse struct {
	AuthorizationID  string `json:"authorization_id"`
	State            string `json:"state"`
	AmountAuthorized int64  `json:"amount_authorized"`
	ExpiresAt        string `json:"expires_at"`
	ReceiptID        string `json:"receipt_id,omitempty"`
	AmountCaptured   *int64 `json:"amount_captured,omitempty"`
}

// lookupHandler is open to a device-scoped credential: it is a read, and the
// point of it is that a till can recover its own answer.
func lookupHandler(logger *slog.Logger, network *Network) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body lookupBody
		if !decodeJSON(w, logger, r, &body) {
			return
		}
		merchantID, ok := requireMerchant(w, logger, r)
		if !ok {
			return
		}

		status, err := network.LookupOrder(r.Context(), merchantID, body.MerchantOrderRef)
		if err != nil {
			writeLookupError(w, logger, err)
			return
		}

		httpx.WriteJSON(w, logger, http.StatusOK, lookupResponse{
			AuthorizationID:  status.AuthorizationID.String(),
			State:            string(status.State),
			AmountAuthorized: status.AmountAuthorized,
			ExpiresAt:        status.ExpiresAt.UTC().Format(time.RFC3339),
			ReceiptID:        status.ReceiptID,
			AmountCaptured:   status.AmountCaptured,
		})
	}
}
