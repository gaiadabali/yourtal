package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/ledger/internal/capture"
	"github.com/yourtal/services/ledger/internal/httpx"
)

// captureVoucher is 4.6.f.2: services/voucher's outbox drainer posts one
// capture here, keyed on captureId (see capture.Engine.Post).
func (a *API) captureVoucher(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CaptureID   string `json:"captureId"`
		Region      string `json:"region"`
		MerchantID  string `json:"merchantId"`
		AmountMinor int64  `json:"amountMinor"`
		Currency    string `json:"currency"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	var merchant pgtype.UUID
	if body.CaptureID == "" || body.AmountMinor <= 0 || merchant.Scan(body.MerchantID) != nil {
		a.fail(w, fmt.Errorf("%w: captureId, a uuid merchantId and a positive amountMinor are required", errBadRequest))
		return
	}
	_, region, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}

	posted, err := a.captures.Post(r.Context(), capture.Request{
		CaptureID: body.CaptureID, Region: region, MerchantID: strings.ToLower(body.MerchantID),
		AmountMinor: body.AmountMinor, Currency: body.Currency,
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"captureId": posted.CaptureID, "region": string(posted.Region), "merchantId": posted.MerchantID,
		"amountMinor": posted.AmountMinor, "currency": posted.Currency, "transferId": posted.TransferID,
		"postedAt": iso(posted.At),
	})
}
