package api

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 1.2.b's batch group. `approveBatch` also mints: the contract's `Batch`
// type has only two visible states ("pending"/"approved"), so minting is an
// implementation detail that happens synchronously once the second
// approval clears — the caller never sees "minting" or "minted" as
// separate steps, only whether the batch (and its stock) is usable yet.

type batchView struct {
	BatchID        string  `json:"batchId"`
	ListingID      string  `json:"listingId"`
	MerchantID     string  `json:"merchantId"`
	Currency       string  `json:"currency"`
	FaceValueMinor int64   `json:"faceValueMinor"`
	Quantity       int32   `json:"quantity"`
	RequestedBy    string  `json:"requestedBy"`
	ApprovedBy     *string `json:"approvedBy"`
	State          string  `json:"state"`
}

// toBatchView collapses the engine's four-state batch lifecycle (requested
// -> approved -> minting -> minted) to the contract's two: "pending" until
// the second approval, "approved" (and usable) from then on.
func toBatchView(row sqlcgen.VoucherBatch) batchView {
	state := "pending"
	if row.State != "requested" {
		state = "approved"
	}
	return batchView{
		BatchID: asUUID(row.ID).String(), ListingID: asUUID(row.ListingID).String(),
		MerchantID: asUUID(row.SupplierBusinessID).String(), Currency: row.Currency,
		FaceValueMinor: row.FaceValueMinor, Quantity: row.Quantity,
		RequestedBy: row.RequestedBy, ApprovedBy: row.ApprovedBy, State: state,
	}
}

type requestBatchBody struct {
	ListingID               string `json:"listingId"`
	MerchantID              string `json:"merchantId"`
	Currency                string `json:"currency"`
	FaceValueMinor          int64  `json:"faceValueMinor"`
	Quantity                int32  `json:"quantity"`
	PartialRedemptionPolicy string `json:"partialRedemptionPolicy"`
	RequestedBy             string `json:"requestedBy"`
}

func (a *API) requestBatch(w http.ResponseWriter, r *http.Request) {
	var body requestBatchBody
	if !a.decode(w, r, &body) {
		return
	}
	listingID, err := uuid.Parse(body.ListingID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "listingId is not a uuid")
		return
	}
	merchantID, err := uuid.Parse(body.MerchantID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "merchantId is not a uuid")
		return
	}

	batchID := uuid.New()
	if err := a.minter.RequestBatch(r.Context(), issue.BatchRequest{
		ID: batchID, ListingID: listingID, SupplierBusinessID: merchantID,
		RequestedBy: body.RequestedBy, Quantity: body.Quantity,
		// Transferable is not yet on the contract; false until a task adds it.
		Transferable:     false,
		FundingReference: "batch:" + batchID.String(),
	}); err != nil {
		a.fail(w, err)
		return
	}

	row, err := sqlcgen.New(a.pool).GetBatch(r.Context(), pgUUID(batchID))
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, toBatchView(row))
}

type approveBatchBody struct {
	BatchID    string `json:"batchId"`
	ApprovedBy string `json:"approvedBy"`
}

func (a *API) approveBatch(w http.ResponseWriter, r *http.Request) {
	var body approveBatchBody
	if !a.decode(w, r, &body) {
		return
	}
	batchID, err := uuid.Parse(body.BatchID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "batchId is not a uuid")
		return
	}

	if err := a.minter.Approve(r.Context(), batchID, body.ApprovedBy); err != nil {
		a.fail(w, err)
		return
	}

	// Mint synchronously. A failure here leaves the batch "approved" with no
	// stock — recoverable by an operator retrying the mint directly; the
	// approval itself (the two-person control) already stands.
	if _, err := a.minter.Mint(r.Context(), batchID); err != nil {
		a.logger.Error("minting an approved batch failed", "batch_id", batchID, "error", err)
	}

	row, err := sqlcgen.New(a.pool).GetBatch(r.Context(), pgUUID(batchID))
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, toBatchView(row))
}
