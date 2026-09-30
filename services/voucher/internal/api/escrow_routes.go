package api

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 13.22's escrow routes. apps/api runs the auction and its payments; these
// move the voucher. Refusals use the gift codes.

type escrowView struct {
	AuctionID        string  `json:"auctionId"`
	SourceVoucherID  string  `json:"sourceVoucherId"`
	VoucherID        string  `json:"voucherId"`
	SellerID         string  `json:"sellerId"`
	Region           string  `json:"region"`
	State            string  `json:"state"`
	ReleasedTo       *string `json:"releasedTo"`
	ListingID        string  `json:"listingId"`
	Title            string  `json:"title"`
	MerchantName     string  `json:"merchantName"`
	Currency         string  `json:"currency"`
	FaceValueMinor   int64   `json:"faceValueMinor"`
	VoucherExpiresAt string  `json:"voucherExpiresAt"`
}

func (a *API) writeEscrow(w http.ResponseWriter, r *http.Request, auctionID uuid.UUID) {
	row, err := sqlcgen.New(a.pool).GetEscrowView(r.Context(), pgUUID(auctionID))
	if err != nil {
		a.fail(w, err)
		return
	}
	var releasedTo *string
	if row.ReleasedTo.Valid {
		value := asUUID(row.ReleasedTo).String()
		releasedTo = &value
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, escrowView{
		AuctionID: asUUID(row.AuctionID).String(), SourceVoucherID: asUUID(row.SourceVoucherID).String(),
		VoucherID: asUUID(row.VoucherID).String(), SellerID: asUUID(row.SellerID).String(),
		Region: row.Region, State: row.State, ReleasedTo: releasedTo,
		ListingID: asUUID(row.ListingID).String(), Title: row.Title, MerchantName: row.MerchantName,
		Currency: row.Currency, FaceValueMinor: row.FaceValueMinor, VoucherExpiresAt: iso(row.VoucherExpiresAt.Time),
	})
}

type escrowHoldBody struct {
	AuctionID string `json:"auctionId"`
	VoucherID string `json:"voucherId"`
	SellerID  string `json:"sellerId"`
	Region    string `json:"region"`
}

func (a *API) escrowHold(w http.ResponseWriter, r *http.Request) {
	var body escrowHoldBody
	if !a.decode(w, r, &body) {
		return
	}
	ids, ok := parseIDs(w, a, body.AuctionID, body.VoucherID, body.SellerID)
	if !ok {
		return
	}
	if err := a.minter.Escrow(r.Context(), issue.EscrowRequest{
		AuctionID: ids[0], VoucherID: ids[1], SellerID: ids[2], Region: body.Region,
	}); err != nil {
		a.failGift(w, err)
		return
	}
	a.writeEscrow(w, r, ids[0])
}

type escrowReleaseBody struct {
	AuctionID string `json:"auctionId"`
	OwnerID   string `json:"ownerId"`
}

func (a *API) escrowRelease(w http.ResponseWriter, r *http.Request) {
	var body escrowReleaseBody
	if !a.decode(w, r, &body) {
		return
	}
	ids, ok := parseIDs(w, a, body.AuctionID, body.OwnerID)
	if !ok {
		return
	}
	if err := a.minter.ReleaseEscrow(r.Context(), ids[0], ids[1]); err != nil {
		a.failGift(w, err)
		return
	}
	a.writeEscrow(w, r, ids[0])
}
