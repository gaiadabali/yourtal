package api

import (
	"net/http"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/ledger"
)

// TASKS.md 10.2.b: services/voucher's own expiry sweep (lifecycle.Expired,
// lifecycle.Voided-by-dead-hold) tells the ledger to release whatever
// liability that voucher still carried. Reachable by "voucher" the same way
// /captures is (Routes(), not platformRoutes -- that group explicitly
// refuses the voucher caller) -- this route IS voucher's own, not
// apps/api's or apps/worker's.
//
// No new table: `ledger.Transfer`'s own idempotency key already makes a
// replay of the same voucher's expiry a no-op, the same way every other
// one-shot posting in this service (capture, burn) relies on it.
func (a *API) expireVoucherLiability(w http.ResponseWriter, r *http.Request) {
	var body struct {
		VoucherID   string `json:"voucherId"`
		Region      string `json:"region"`
		AmountMinor int64  `json:"amountMinor"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if body.VoucherID == "" || body.AmountMinor <= 0 {
		a.fail(w, errBadRequest)
		return
	}
	region := ledger.Region(body.Region)
	if region != ledger.RegionAU && region != ledger.RegionID {
		a.fail(w, errBadRequest)
		return
	}
	result, err := a.ledger.Transfer(r.Context(), ledger.TransferRequest{
		ID:             "led_txn_voucher_expire_" + body.VoucherID,
		IdempotencyKey: "voucher_expire_" + body.VoucherID,
		ReasonCode:     "voucher_expire",
		Entries:        ledger.VoucherExpiry(region, body.AmountMinor),
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"voucherId": body.VoucherID, "transferId": result.TransferID,
	})
}
