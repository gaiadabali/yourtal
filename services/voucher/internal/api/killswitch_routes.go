package api

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 4.5.d's kill-switch HTTP route, next to the existing CLI. Lifting is not
// exposed here yet — nothing in TASKS.md 4.5 asks for it, and adding a
// route nobody specified is how an emergency-stop surface grows an
// unreviewed second way to turn itself off.

type killSwitchView struct {
	KillSwitchID string  `json:"killSwitchId"`
	Scope        string  `json:"scope"`
	TargetID     *string `json:"targetId"`
	Reason       string  `json:"reason"`
	SetBy        string  `json:"setBy"`
	Active       bool    `json:"active"`
	SetAt        string  `json:"setAt"`
}

func toKillSwitchView(row sqlcgen.VoucherKillSwitch) killSwitchView {
	var target *string
	if row.ScopeID.Valid {
		id := asUUID(row.ScopeID).String()
		target = &id
	}
	return killSwitchView{
		KillSwitchID: asUUID(row.ID).String(), Scope: row.Scope, TargetID: target,
		Reason: row.Reason, SetBy: row.EnabledBy, Active: !row.LiftedAt.Valid, SetAt: iso(row.EnabledAt.Time),
	}
}

type setKillSwitchBody struct {
	Scope    string  `json:"scope"`
	TargetID *string `json:"targetId"`
	Reason   string  `json:"reason"`
	SetBy    string  `json:"setBy"`
	Active   bool    `json:"active"`
}

func (a *API) setKillSwitch(w http.ResponseWriter, r *http.Request) {
	var body setKillSwitchBody
	if !a.decode(w, r, &body) {
		return
	}
	if !body.Active {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "refused",
			"lifting a kill switch is not served by this route yet")
		return
	}

	var target pgtype.UUID
	if body.TargetID != nil && *body.TargetID != "" {
		id, err := uuid.Parse(*body.TargetID)
		if err != nil {
			httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "targetId is not a uuid")
			return
		}
		target = pgUUID(id)
	} else if body.Scope != "global" {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "refused",
			"a non-global kill switch needs a targetId")
		return
	}

	id := uuid.New()
	if err := sqlcgen.New(a.pool).EnableKillSwitch(r.Context(), sqlcgen.EnableKillSwitchParams{
		ID: pgUUID(id), Scope: body.Scope, ScopeID: target, Reason: body.Reason, EnabledBy: body.SetBy,
	}); err != nil {
		a.fail(w, err)
		return
	}

	row, err := sqlcgen.New(a.pool).ListActiveKillSwitches(r.Context())
	if err != nil {
		a.fail(w, err)
		return
	}
	for _, ks := range row {
		if asUUID(ks.ID) == id {
			httpx.WriteJSON(w, a.logger, http.StatusOK, toKillSwitchView(ks))
			return
		}
	}
	httpx.WriteError(w, a.logger, http.StatusInternalServerError, "api_error", "internal_error", "something went wrong")
}

func (a *API) listKillSwitches(w http.ResponseWriter, r *http.Request) {
	rows, err := sqlcgen.New(a.pool).ListActiveKillSwitches(r.Context())
	if err != nil {
		a.fail(w, err)
		return
	}
	views := make([]killSwitchView, len(rows))
	for i, row := range rows {
		views[i] = toKillSwitchView(row)
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, views)
}
