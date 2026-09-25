package api

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

type merchantCaptureStatsBody struct {
	MerchantID string `json:"merchantId"`
	From       string `json:"from"`
	To         string `json:"to"`
}

func (a *API) merchantCaptureStats(w http.ResponseWriter, r *http.Request) {
	var body merchantCaptureStatsBody
	if !a.decode(w, r, &body) {
		return
	}
	merchantID, err := uuid.Parse(body.MerchantID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "merchantId is not a uuid")
		return
	}
	from, err := time.Parse("2006-01-02", body.From)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_date", "from is not a date")
		return
	}
	// Exclusive upper bound, one day past `to`, so the whole named day
	// (`to`) is included.
	to, err := time.Parse("2006-01-02", body.To)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_date", "to is not a date")
		return
	}
	to = to.AddDate(0, 0, 1)

	row, err := sqlcgen.New(a.pool).SumMerchantCaptures(r.Context(), sqlcgen.SumMerchantCapturesParams{
		MerchantID:  pgUUID(merchantID),
		CreatedAt:   pgtype.Timestamptz{Time: from, Valid: true},
		CreatedAt_2: pgtype.Timestamptz{Time: to, Valid: true},
	})
	if err != nil {
		a.fail(w, err)
		return
	}

	currency := row.Currency
	if currency == "" {
		// No captures in range: the contract still wants a currency. AUD is
		// the platform default (F2); a merchant with zero captures in a
		// window has no real currency to report anyway.
		currency = "AUD"
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"merchantId": merchantID.String(), "currency": currency,
		"captureCount": row.CaptureCount, "capturedMinor": row.CapturedMinor,
	})
}
