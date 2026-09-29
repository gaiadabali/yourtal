package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/yourtal/services/ledger/internal/escrow"
	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// TASKS.md 10.5: the staff console's manual-review queue, reading and
// resolving 10.4's ledger.risk_flag rows through the ledger's own routes --
// yourtal_app has no grant on that table, same wall as every other
// ledger-owned one.

// optionalString is nil for "", the same convention reward's own optional()
// uses for device/IP fields on a grant.
func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func riskFlagView(row sqlcgen.LedgerRiskFlag) map[string]any {
	var signals []map[string]string
	// A malformed signals payload cannot happen (this service is the only
	// writer), but a nil slice would print as null; an empty one reads
	// better to a reviewer.
	_ = json.Unmarshal(row.Signals, &signals)
	if signals == nil {
		signals = []map[string]string{}
	}
	view := map[string]any{
		"id": row.ID, "userId": row.UserID, "region": row.Region,
		"severity": row.Severity, "reason": row.Reason, "signals": signals,
		"status": row.Status, "createdAt": iso(row.CreatedAt.Time),
	}
	if row.EscrowID != nil {
		view["escrowId"] = *row.EscrowID
	}
	if row.ResolvedAt.Valid {
		view["resolvedAt"] = iso(row.ResolvedAt.Time)
	}
	if row.ResolvedBy != nil {
		view["resolvedBy"] = *row.ResolvedBy
	}
	if row.ResolutionNote != nil {
		view["resolutionNote"] = *row.ResolutionNote
	}
	return view
}

func (a *API) riskQueueList(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Region string `json:"region"`
		Limit  int32  `json:"limit,omitempty"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if _, _, ok := a.engineFor(w, body.Region); !ok {
		return
	}
	limit := body.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := sqlcgen.New(a.pool).ListRiskQueue(r.Context(), sqlcgen.ListRiskQueueParams{
		Region: body.Region, LimitCount: limit,
	})
	if err != nil {
		a.fail(w, fmt.Errorf("listing the risk queue: %w", err))
		return
	}
	views := make([]map[string]any, len(rows))
	for i, row := range rows {
		views[i] = riskFlagView(row)
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"flags": views})
}

// riskQueueRelease dismisses a flag: a soft "flag" is simply marked
// released, and a "block" that auto-held the balance also releases that
// escrow — the same reversal 9.4.b's own user release performs, so a
// reviewer sees the same points come back the same way either time.
func (a *API) riskQueueRelease(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID             string `json:"id"`
		ResolvedBy     string `json:"resolvedBy"`
		ResolutionNote string `json:"resolutionNote,omitempty"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if body.ID == "" || body.ResolvedBy == "" {
		a.fail(w, fmt.Errorf("%w: id and resolvedBy are required", errBadRequest))
		return
	}
	q := sqlcgen.New(a.pool)
	flag, err := q.GetRiskFlag(r.Context(), body.ID)
	if err != nil {
		a.fail(w, fmt.Errorf("%w: no risk flag %s", errNotFound, body.ID))
		return
	}
	if flag.EscrowID != nil {
		if _, err := a.escrows.Release(r.Context(), *flag.EscrowID); err != nil {
			a.fail(w, err)
			return
		}
	}
	resolved, err := q.ResolveRiskFlag(r.Context(), sqlcgen.ResolveRiskFlagParams{
		Status: "released", ResolvedBy: &body.ResolvedBy, ResolutionNote: optionalString(body.ResolutionNote), ID: body.ID,
	})
	if err != nil {
		a.fail(w, fmt.Errorf("%w: %s is not pending", errNotFound, body.ID))
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, riskFlagView(resolved))
}

// riskQueueSuspend escalates a flag staff has decided is real: holds the
// account's current balance into escrow (a no-op if 10.4's own gate already
// held it for a "block" severity — Hold is idempotent on its own key), then
// marks the flag suspended.
func (a *API) riskQueueSuspend(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID             string `json:"id"`
		ResolvedBy     string `json:"resolvedBy"`
		ResolutionNote string `json:"resolutionNote,omitempty"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if body.ID == "" || body.ResolvedBy == "" {
		a.fail(w, fmt.Errorf("%w: id and resolvedBy are required", errBadRequest))
		return
	}
	q := sqlcgen.New(a.pool)
	flag, err := q.GetRiskFlag(r.Context(), body.ID)
	if err != nil {
		a.fail(w, fmt.Errorf("%w: no risk flag %s", errNotFound, body.ID))
		return
	}
	escrowID := flag.EscrowID
	if escrowID == nil {
		available, err := a.ledger.Balance(r.Context(), ledger.UserAccountID(flag.UserID, ledger.PurposeAvailable))
		if err != nil {
			a.fail(w, err)
			return
		}
		pending, err := a.ledger.Balance(r.Context(), ledger.UserAccountID(flag.UserID, ledger.PurposePending))
		if err != nil {
			a.fail(w, err)
			return
		}
		if total := available + pending; total > 0 {
			held, err := a.escrows.Hold(r.Context(), escrow.Request{
				UserID: flag.UserID, Points: total, Reason: "risk: " + flag.Reason,
				IdempotencyKey: "risk_suspend_" + body.ID,
			})
			if err != nil {
				a.fail(w, err)
				return
			}
			escrowID = &held.ID
		}
	}
	resolved, err := q.ResolveRiskFlag(r.Context(), sqlcgen.ResolveRiskFlagParams{
		Status: "suspended", ResolvedBy: &body.ResolvedBy, ResolutionNote: optionalString(body.ResolutionNote),
		EscrowID: escrowID, ID: body.ID,
	})
	if err != nil {
		a.fail(w, fmt.Errorf("%w: %s is not pending", errNotFound, body.ID))
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, riskFlagView(resolved))
}
