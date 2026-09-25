package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// ledger-internal's funding-and-allocations group.

type allocationView struct {
	AllocationID    string `json:"allocationId"`
	BusinessID      string `json:"businessId"`
	Region          string `json:"region"`
	FunderType      string `json:"funderType"`
	TotalPoints     int64  `json:"totalPoints"`
	RemainingPoints int64  `json:"remainingPoints"`
	CreatedAt       string `json:"createdAt"`
}

func toAllocationView(id, funderType, funderID string, region *string, total, remaining int64, created pgtype.Timestamptz) allocationView {
	view := allocationView{AllocationID: id, BusinessID: funderID, FunderType: funderType,
		TotalPoints: total, RemainingPoints: remaining, CreatedAt: iso(created.Time)}
	if region != nil {
		view.Region = *region
	}
	return view
}

func (a *API) allocationByID(w http.ResponseWriter, r *http.Request, id string) {
	row, err := sqlcgen.New(a.pool).GetAllocationWithRegion(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		a.fail(w, fmt.Errorf("%w: allocation %s", errNotFound, id))
		return
	}
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, toAllocationView(row.ID, row.FunderType, row.FunderID, row.Region,
		row.TotalPoints, row.RemainingPoints, row.CreatedAt))
}

func (a *API) purchasePoints(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BusinessID     string `json:"businessId"`
		Region         string `json:"region"`
		Currency       string `json:"currency"`
		Points         int64  `json:"points"`
		PaidMinor      int64  `json:"paidMinor"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	engine, _, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	bought, err := engine.PurchasePoints(r.Context(), reward.PurchaseRequest{
		ID: body.IdempotencyKey, PartnerID: body.BusinessID, Points: body.Points,
		AmountMinor: body.PaidMinor, Currency: body.Currency,
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	a.allocationByID(w, r, bought.AllocationID)
}

func (a *API) listAllocations(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BusinessID string `json:"businessId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	rows, err := sqlcgen.New(a.pool).ListAllocationsForFunder(r.Context(), body.BusinessID)
	if err != nil {
		a.fail(w, err)
		return
	}
	views := make([]allocationView, 0, len(rows))
	for _, row := range rows {
		views = append(views, toAllocationView(row.ID, row.FunderType, row.FunderID, row.Region,
			row.TotalPoints, row.RemainingPoints, row.CreatedAt))
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, views)
}

func (a *API) getAllocation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AllocationID string `json:"allocationId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	a.allocationByID(w, r, body.AllocationID)
}

// defaultHoldTTL covers a one-hour video: 2 × duration + 1 h (4.4.e).
const defaultHoldTTL = 3 * time.Hour

func holdID(sagaID string) string { return "hold_" + sagaID }

func (a *API) holdView(w http.ResponseWriter, r *http.Request, id string) {
	row, err := sqlcgen.New(a.pool).GetHold(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		a.fail(w, fmt.Errorf("%w: hold %s", errNotFound, id))
		return
	}
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"holdId": row.ID, "allocationId": row.AllocationID, "points": row.Points,
		"sagaId": strings.TrimPrefix(row.ID, "hold_"), "state": row.State,
	})
}

func (a *API) hold(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AllocationID string `json:"allocationId"`
		Points       int64  `json:"points"`
		SagaID       string `json:"sagaId"`
		TTLSeconds   int64  `json:"ttlSeconds,omitempty"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	ttl := defaultHoldTTL
	if body.TTLSeconds > 0 {
		ttl = time.Duration(body.TTLSeconds) * time.Second
	}
	if err := a.rewards["AU"].Hold(r.Context(), reward.HoldRequest{
		ID: holdID(body.SagaID), AllocationID: body.AllocationID, Points: body.Points, TTL: ttl,
	}); err != nil {
		a.fail(w, err)
		return
	}
	a.holdView(w, r, holdID(body.SagaID))
}

// consume spends a live hold in full; a grant that uses a hold consumes it
// itself (grantReward's holdId).
func (a *API) consume(w http.ResponseWriter, r *http.Request) {
	var body struct {
		HoldID string `json:"holdId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	queries := sqlcgen.New(a.pool)
	held, err := queries.GetHold(r.Context(), body.HoldID)
	if err == nil && held.State == "held" {
		_, err = queries.ConsumeHold(r.Context(), sqlcgen.ConsumeHoldParams{HoldID: body.HoldID, Points: held.Points})
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		a.fail(w, err)
		return
	}
	a.holdView(w, r, body.HoldID)
}

func (a *API) release(w http.ResponseWriter, r *http.Request) {
	var body struct {
		HoldID string `json:"holdId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if _, err := a.rewards["AU"].Release(r.Context(), body.HoldID); err != nil {
		a.fail(w, err)
		return
	}
	a.holdView(w, r, body.HoldID)
}

func (a *API) returnGrant(w http.ResponseWriter, r *http.Request) {
	var body struct {
		GrantID string `json:"grantId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if _, err := a.rewards["AU"].ReturnGrant(r.Context(), body.GrantID); err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{})
}

func (a *API) campaignSpend(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CampaignID string `json:"campaignId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	var campaign pgtype.UUID
	if campaign.Scan(body.CampaignID) != nil {
		a.fail(w, fmt.Errorf("%w: campaignId is not a uuid", errBadRequest))
		return
	}
	queries := sqlcgen.New(a.pool)
	config, err := queries.GetRewardConfig(r.Context(), campaign)
	if errors.Is(err, pgx.ErrNoRows) {
		a.fail(w, fmt.Errorf("%w: campaign %s has no reward config", errNotFound, body.CampaignID))
		return
	}
	if err != nil {
		a.fail(w, err)
		return
	}
	spend, err := queries.CampaignSpend(r.Context(), campaign)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"campaignId": body.CampaignID, "allocationId": config.AllocationID,
		"grantedPoints": spend.GrantedPoints, "completions": spend.Completions,
	})
}
