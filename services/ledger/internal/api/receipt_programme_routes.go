package api

import (
	"fmt"
	"net/http"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// maxReceiptPackages bounds one stats call: a funder holds a handful of packages.
const maxReceiptPackages = 200

// receiptProgrammeStats is the staff console's read of what a partner's
// receipt packages have paid (2.9.c): all-time and last-7-day points, and the
// ten users paid most over 30 days. Read-only. It names no rate, and the
// users are the ledger's own ids.
func (a *API) receiptProgrammeStats(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Region        string   `json:"region"`
		AllocationIDs []string `json:"allocationIds"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	_, region, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	if len(body.AllocationIDs) > maxReceiptPackages {
		a.fail(w, fmt.Errorf("%w: at most %d allocations", errBadRequest, maxReceiptPackages))
		return
	}
	ids := body.AllocationIDs
	if ids == nil {
		ids = []string{}
	}
	q := sqlcgen.New(a.pool)
	paid, err := q.ReceiptProgrammePaid(r.Context(), sqlcgen.ReceiptProgrammePaidParams{
		Region: string(region), AllocationIds: ids,
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	top, err := q.ReceiptProgrammeTopEarners(r.Context(), sqlcgen.ReceiptProgrammeTopEarnersParams{
		Region: string(region), AllocationIds: ids,
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	earners := make([]map[string]any, 0, len(top))
	for _, row := range top {
		earners = append(earners, map[string]any{"userId": row.UserID, "points": row.Points, "receipts": row.Receipts})
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"paidPoints": paid.PaidPoints, "paidLast7Days": paid.PaidLast7Days, "topEarners": earners,
	})
}
