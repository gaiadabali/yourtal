package api

import (
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 2.8 T2 (docs/28 4.2): "is this code in this person's wallet?", asked by
// apps/api on behalf of a partner (SnapApp) before the partner spends a
// merchant call. The caller already proved who the owner is; the hash is all
// it holds of the code. Anything that is not an owned, live-or-used voucher
// answers the identical `{"held": false}`, so the route is no oracle for
// codes that belong to somebody else.

var sha256Hex = regexp.MustCompile(`^[0-9a-f]{64}$`)

type holdingBody struct {
	CodeSha256 string `json:"codeSha256"`
	OwnerID    string `json:"ownerId"`
}

type holdingView struct {
	Held            bool    `json:"held"`
	Status          string  `json:"status,omitempty"`
	FaceValueMinor  int64   `json:"faceValueMinor,omitempty"`
	Currency        string  `json:"currency,omitempty"`
	ExpiresAt       string  `json:"expiresAt,omitempty"`
	Region          string  `json:"region,omitempty"`
	RedeemPartnerID *string `json:"redeemPartnerId,omitempty"`
}

// holdingOf maps a row to the answer. A voided voucher is not held (there is
// nothing to redeem or to explain); an active or held voucher past its expiry
// reads expired before the sweep runs, as the merchant lookup does.
func holdingOf(row sqlcgen.GetHoldingRow, now time.Time) holdingView {
	status := row.State
	switch status {
	case "active", "held":
		if !row.ExpiresAt.Time.After(now) {
			status = "expired"
		}
	case "redeemed", "expired":
	default:
		return holdingView{}
	}
	return holdingView{
		Held: true, Status: status, FaceValueMinor: row.FaceValueMinor, Currency: row.Currency,
		ExpiresAt: iso(row.ExpiresAt.Time), Region: row.Region, RedeemPartnerID: row.RedeemPartnerID,
	}
}

func (a *API) holding(w http.ResponseWriter, r *http.Request) {
	var body holdingBody
	if !a.decode(w, r, &body) {
		return
	}
	ownerID, err := uuid.Parse(body.OwnerID)
	if err != nil || !sha256Hex.MatchString(body.CodeSha256) {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id",
			"ownerId must be a uuid and codeSha256 64 lower-case hex digits")
		return
	}

	row, err := sqlcgen.New(a.pool).GetHolding(r.Context(), sqlcgen.GetHoldingParams{
		CodeHash: body.CodeSha256, OwnerID: pgUUID(ownerID),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteJSON(w, a.logger, http.StatusOK, holdingView{})
		return
	}
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, holdingOf(row, time.Now().UTC()))
}
