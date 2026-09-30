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

type voucherStatusBody struct {
	MerchantID string `json:"merchantId"`
	Region     string `json:"region"`
}

type voucherStatusRow struct {
	Status         string `json:"status"`
	Count          int64  `json:"count"`
	FaceValueMinor int64  `json:"faceValueMinor"`
}

// merchantVoucherStatus is 13.10: counts only, never a voucher or an owner.
// The caller applies the cohort floor.
func (a *API) merchantVoucherStatus(w http.ResponseWriter, r *http.Request) {
	var body voucherStatusBody
	if !a.decode(w, r, &body) {
		return
	}
	merchantID, err := uuid.Parse(body.MerchantID)
	if err != nil || (body.Region != "AU" && body.Region != "ID") {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_request", "merchantId or region is invalid")
		return
	}
	found, err := sqlcgen.New(a.pool).CountMerchantVouchersByStatus(r.Context(), sqlcgen.CountMerchantVouchersByStatusParams{
		MerchantID: pgUUID(merchantID), Region: body.Region,
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	currency := map[string]string{"AU": "AUD", "ID": "IDR"}[body.Region]
	rows := make([]voucherStatusRow, len(found))
	for i, row := range found {
		rows[i] = voucherStatusRow{Status: row.Status, Count: row.VoucherCount, FaceValueMinor: row.FaceValueMinor}
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"merchantId": merchantID.String(), "region": body.Region, "currency": currency, "rows": rows,
	})
}
