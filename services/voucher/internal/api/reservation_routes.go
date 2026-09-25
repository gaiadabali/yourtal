package api

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/issue"
)

type reservationView struct {
	VoucherID string `json:"voucherId"`
	ListingID string `json:"listingId"`
	SagaID    string `json:"sagaId"`
	State     string `json:"state"`
}

func toReservationView(r issue.Reservation) reservationView {
	return reservationView{
		VoucherID: r.VoucherID.String(), ListingID: r.ListingID.String(),
		SagaID: r.SagaID, State: contractState(string(r.State)),
	}
}

type reserveBody struct {
	ListingID string `json:"listingId"`
	SagaID    string `json:"sagaId"`
}

// reserve is the stock reservation (4.5.a): Minted -> Allocated.
func (a *API) reserve(w http.ResponseWriter, r *http.Request) {
	var body reserveBody
	if !a.decode(w, r, &body) {
		return
	}
	listingID, err := uuid.Parse(body.ListingID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "listingId is not a uuid")
		return
	}
	if body.SagaID == "" {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "missing_saga", "sagaId is required")
		return
	}

	reservation, err := a.minter.Reserve(r.Context(), listingID, body.SagaID)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, toReservationView(reservation))
}

type sagaBody struct {
	SagaID string `json:"sagaId"`
}

// release is Allocated -> Minted (4.5.a), callable at any time — the caller
// (apps/api's burn saga, 4.7) checks `getBurn` first.
func (a *API) release(w http.ResponseWriter, r *http.Request) {
	var body sagaBody
	if !a.decode(w, r, &body) {
		return
	}
	if _, err := a.minter.ReleaseReservation(r.Context(), body.SagaID); err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]bool{"released": true})
}

type activateBody struct {
	SagaID  string `json:"sagaId"`
	OwnerID string `json:"ownerId"`
}

// activate is Allocated -> Active (4.5.a): the burn succeeded, and the
// voucher is now the user's.
func (a *API) activate(w http.ResponseWriter, r *http.Request) {
	var body activateBody
	if !a.decode(w, r, &body) {
		return
	}
	owner, err := uuid.Parse(body.OwnerID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "ownerId is not a uuid")
		return
	}

	reservation, err := a.minter.ActivateReservation(r.Context(), body.SagaID, owner)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, toReservationView(reservation))
}
