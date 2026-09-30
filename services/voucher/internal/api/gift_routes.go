package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 13.20's gift routes. apps/api has already decided the sender and the
// recipient are verified adults; these enforce the voucher's own rules.
// Refusals answer 409 {"code","message"} with the gift contract's codes.

var giftCodes = []struct {
	err  error
	code string
}{
	{issue.ErrNotUnused, "not_unused"},
	{issue.ErrNotTransferable, "not_transferable"},
	{issue.ErrAlreadyGifted, "already_gifted"},
	{issue.ErrHoldback, "holdback"},
	{issue.ErrGiftVelocity, "velocity_capped"},
	{issue.ErrGiftRegion, "region_mismatch"},
	{issue.ErrGiftToSelf, "gift_to_self"},
	{issue.ErrGiftNotPending, "not_pending"},
	{issue.ErrGiftWindowClosed, "window_closed"},
	{issue.ErrEscrowReleased, "not_pending"},
}

func (a *API) failGift(w http.ResponseWriter, err error) {
	for _, known := range giftCodes {
		if errors.Is(err, known.err) {
			httpx.WriteJSON(w, a.logger, http.StatusConflict, map[string]string{"code": known.code, "message": err.Error()})
			return
		}
	}
	a.fail(w, err)
}

type giftView struct {
	GiftID           string  `json:"giftId"`
	SourceVoucherID  string  `json:"sourceVoucherId"`
	VoucherID        string  `json:"voucherId"`
	SenderID         string  `json:"senderId"`
	RecipientID      string  `json:"recipientId"`
	Region           string  `json:"region"`
	State            string  `json:"state"`
	CreatedAt        string  `json:"createdAt"`
	ExpiresAt        string  `json:"expiresAt"`
	ResolvedAt       *string `json:"resolvedAt"`
	Title            string  `json:"title"`
	MerchantName     string  `json:"merchantName"`
	Currency         string  `json:"currency"`
	FaceValueMinor   int64   `json:"faceValueMinor"`
	VoucherExpiresAt string  `json:"voucherExpiresAt"`
}

func toGiftView(row sqlcgen.ListGiftsForUserRow) giftView {
	var resolved *string
	if row.ResolvedAt.Valid {
		value := iso(row.ResolvedAt.Time)
		resolved = &value
	}
	return giftView{
		GiftID: asUUID(row.ID).String(), SourceVoucherID: asUUID(row.SourceVoucherID).String(),
		VoucherID: asUUID(row.VoucherID).String(), SenderID: asUUID(row.SenderID).String(),
		RecipientID: asUUID(row.RecipientID).String(), Region: row.Region, State: row.State,
		CreatedAt: iso(row.CreatedAt.Time), ExpiresAt: iso(row.ExpiresAt.Time), ResolvedAt: resolved,
		Title: row.Title, MerchantName: row.MerchantName, Currency: row.Currency,
		FaceValueMinor: row.FaceValueMinor, VoucherExpiresAt: iso(row.VoucherExpiresAt.Time),
	}
}

func (a *API) writeGift(w http.ResponseWriter, r *http.Request, giftID uuid.UUID) {
	row, err := sqlcgen.New(a.pool).GetGiftView(r.Context(), pgUUID(giftID))
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, toGiftView(sqlcgen.ListGiftsForUserRow(row)))
}

type giftBody struct {
	VoucherID       string `json:"voucherId"`
	SenderID        string `json:"senderId"`
	RecipientID     string `json:"recipientId"`
	RecipientRegion string `json:"recipientRegion"`
}

func (a *API) gift(w http.ResponseWriter, r *http.Request) {
	var body giftBody
	if !a.decode(w, r, &body) {
		return
	}
	ids, ok := parseIDs(w, a, body.VoucherID, body.SenderID, body.RecipientID)
	if !ok {
		return
	}
	giftID, err := a.minter.Gift(r.Context(), issue.GiftRequest{
		VoucherID: ids[0], SenderID: ids[1], RecipientID: ids[2], RecipientRegion: body.RecipientRegion,
	})
	if err != nil {
		a.failGift(w, err)
		return
	}
	a.writeGift(w, r, giftID)
}

type resolveGiftBody struct {
	GiftID      string `json:"giftId"`
	RecipientID string `json:"recipientId"`
}

func (a *API) acceptGift(w http.ResponseWriter, r *http.Request) {
	a.resolveGift(w, r, a.minter.AcceptGift)
}

func (a *API) declineGift(w http.ResponseWriter, r *http.Request) {
	a.resolveGift(w, r, a.minter.DeclineGift)
}

func (a *API) resolveGift(w http.ResponseWriter, r *http.Request, act func(ctx context.Context, gift, recipient uuid.UUID) error) {
	var body resolveGiftBody
	if !a.decode(w, r, &body) {
		return
	}
	ids, ok := parseIDs(w, a, body.GiftID, body.RecipientID)
	if !ok {
		return
	}
	if err := act(r.Context(), ids[0], ids[1]); err != nil {
		a.failGift(w, err)
		return
	}
	a.writeGift(w, r, ids[0])
}

type listGiftsBody struct {
	UserID string `json:"userId"`
	Limit  int32  `json:"limit"`
}

func (a *API) listGifts(w http.ResponseWriter, r *http.Request) {
	var body listGiftsBody
	if !a.decode(w, r, &body) {
		return
	}
	ids, ok := parseIDs(w, a, body.UserID)
	if !ok {
		return
	}
	limit := body.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := sqlcgen.New(a.pool).ListGiftsForUser(r.Context(), sqlcgen.ListGiftsForUserParams{
		SenderID: pgUUID(ids[0]), Limit: limit,
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	gifts := make([]giftView, len(rows))
	for i, row := range rows {
		gifts[i] = toGiftView(row)
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"gifts": gifts})
}

// parseIDs parses every id or answers 400 naming none of them in particular.
func parseIDs(w http.ResponseWriter, a *API, values ...string) ([]uuid.UUID, bool) {
	ids := make([]uuid.UUID, len(values))
	for i, value := range values {
		id, err := uuid.Parse(value)
		if err != nil {
			httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "an id is not a uuid")
			return nil, false
		}
		ids[i] = id
	}
	return ids, true
}
