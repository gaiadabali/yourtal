package api

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/proof"
)

// maxAnchorsPerCall bounds one request; the poster sends batches of 100.
const maxAnchorsPerCall = 500

// anchorVoucherHeads is 4.6.h: services/voucher anchors its chain heads, and
// the day's proof root covers them when that day is recorded.
func (a *API) anchorVoucherHeads(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Heads []struct {
			VoucherID string `json:"voucherId"`
			Seq       int64  `json:"seq"`
			HeadHash  string `json:"headHash"`
			Region    string `json:"region"`
		} `json:"heads"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if len(body.Heads) > maxAnchorsPerCall {
		a.fail(w, fmt.Errorf("%w: at most %d heads per call", errBadRequest, maxAnchorsPerCall))
		return
	}
	heads := make([]proof.VoucherHeadLeaf, 0, len(body.Heads))
	for _, h := range body.Heads {
		heads = append(heads, proof.VoucherHeadLeaf{VoucherID: h.VoucherID, Seq: h.Seq, HeadHash: h.HeadHash, Region: h.Region})
	}

	added, err := a.proof.AnchorHeads(r.Context(), heads)
	switch {
	case errors.Is(err, proof.ErrBadAnchor):
		a.fail(w, fmt.Errorf("%w: %w", errBadRequest, err))
	case errors.Is(err, proof.ErrAnchorConflict):
		httpx.WriteJSON(w, a.logger, http.StatusConflict, map[string]string{"code": "idempotency_conflict", "message": err.Error()})
	case err != nil:
		a.fail(w, err)
	default:
		httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"received": len(heads), "anchored": added})
	}
}
