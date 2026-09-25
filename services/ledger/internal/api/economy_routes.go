package api

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// ledger-internal's economy group. B appears here and nowhere else: these
// routes are for staff tooling (9.5), behind the same service auth.

func (a *API) coverage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Region string `json:"region"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	_, region, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	measured, err := pricing.CoverageNow(r.Context(), sqlcgen.New(a.pool), region)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"region": body.Region, "ratio": float64(measured.RatioBps) / 10_000,
		"reserveMinor": measured.ReserveMinor, "pointsOutstanding": measured.PointsOutstanding,
		"asOf": iso(measured.MeasuredAt), "nothingOwed": measured.NoPointsOutstanding,
	})
}

func (a *API) proposalView(w http.ResponseWriter, r *http.Request, id, region string) {
	row, err := sqlcgen.New(a.pool).GetRateProposal(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		a.fail(w, fmt.Errorf("%w: rate proposal %s", errNotFound, id))
		return
	}
	if err != nil {
		a.fail(w, err)
		return
	}
	state := "pending"
	if row.ApprovedBy != nil {
		state = "approved"
	}
	if region == "" {
		region = map[string]string{"AUD": "AU", "IDR": "ID"}[row.Currency]
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"proposalId": row.ID, "region": region, "backingRateMicrosPerPoint": row.MicrosPerPoint,
		"proposedBy": row.SetBy, "approvedBy": row.ApprovedBy, "state": state,
	})
}

// proposeRate proposes a new B at the issue price now in force; the margin
// rule (B × 1.25 ≤ P_issue) still applies.
func (a *API) proposeRate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Region                    string `json:"region"`
		Currency                  string `json:"currency"`
		BackingRateMicrosPerPoint int64  `json:"backingRateMicrosPerPoint"`
		ProposedBy                string `json:"proposedBy"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	_, region, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	if body.Currency != string(region.Currency()) {
		a.fail(w, fmt.Errorf("%w: %s in %s", pricing.ErrRegionMismatch, body.Currency, region))
		return
	}
	current, err := sqlcgen.New(a.pool).GetBackingRateInForce(r.Context(), body.Currency)
	if err != nil {
		a.fail(w, fmt.Errorf("%w: %w", pricing.ErrNoRateInForce, err))
		return
	}
	id := "rate_" + randomHex()
	if err := a.pricing.ProposeRate(r.Context(), pricing.Rate{
		ID: id, Currency: body.Currency, MicrosPerPoint: body.BackingRateMicrosPerPoint,
		IssuePriceMicrosPerPoint: current.IssuePriceMicrosPerPoint,
		Reason:                   "proposed through ledger-internal", SetBy: body.ProposedBy,
	}); err != nil {
		a.fail(w, err)
		return
	}
	a.proposalView(w, r, id, body.Region)
}

func (a *API) approveRate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProposalID string `json:"proposalId"`
		ApprovedBy string `json:"approvedBy"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if _, err := a.pricing.ApproveRate(r.Context(), body.ProposalID, body.ApprovedBy); err != nil {
		a.fail(w, err)
		return
	}
	a.proposalView(w, r, body.ProposalID, "")
}

func (a *API) fundMarketing(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Region      string `json:"region"`
		AmountMinor int64  `json:"amountMinor"`
		ProposedBy  string `json:"proposedBy"`
		ApprovedBy  string `json:"approvedBy"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	engine, _, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	if _, err := engine.FundMarketing(r.Context(), randomHex(), body.AmountMinor, body.ProposedBy, body.ApprovedBy); err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{})
}

func randomHex() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
