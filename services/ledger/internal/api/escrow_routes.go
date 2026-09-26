package api

import (
	"net/http"

	"github.com/yourtal/services/ledger/internal/escrow"
	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// ledger-internal's users group: escrow and its release (9.4.b).

func escrowView(e escrow.Escrow) map[string]any {
	state := "held"
	if e.Released {
		state = "released"
	}
	return map[string]any{"escrowId": e.ID, "userId": e.UserID, "points": e.Points, "reason": e.Reason, "state": state}
}

func (a *API) escrow(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID         string `json:"userId"`
		Points         int64  `json:"points"`
		Reason         string `json:"reason"`
		IdempotencyKey string `json:"idempotencyKey,omitempty"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	held, err := a.escrows.Hold(r.Context(), escrow.Request{
		UserID: body.UserID, Points: body.Points, Reason: body.Reason, IdempotencyKey: body.IdempotencyKey,
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, escrowView(held))
}

func (a *API) releaseEscrow(w http.ResponseWriter, r *http.Request) {
	var body struct {
		EscrowID string `json:"escrowId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	released, err := a.escrows.Release(r.Context(), body.EscrowID)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, escrowView(released))
}

// withoutEscrowed trims the pending buckets to the pending account's balance:
// what escrow took from pending is not pending, so it comes off the latest
// unlocks first. Buckets are in unlock order.
func withoutEscrowed(buckets []sqlcgen.PendingBucketsRow, pendingBalance int64) []sqlcgen.PendingBucketsRow {
	kept := make([]sqlcgen.PendingBucketsRow, 0, len(buckets))
	for _, b := range buckets {
		if pendingBalance <= 0 {
			break
		}
		b.Points = min(b.Points, pendingBalance)
		pendingBalance -= b.Points
		kept = append(kept, b)
	}
	return kept
}
