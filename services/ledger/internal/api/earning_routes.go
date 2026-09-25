package api

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/ledger/internal/attest"
	"github.com/yourtal/services/ledger/internal/burn"
	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// ledger-internal's earning-and-spending and users groups.

func grantView(kind, userID string, g reward.GrantResult) map[string]any {
	unlock := g.UnlockAt
	if unlock.IsZero() {
		unlock = g.GrantedAt
	}
	return map[string]any{
		"grantId": g.GrantID, "kind": kind, "userId": userID, "region": string(g.Region),
		"points": g.Points, "unlockAt": iso(unlock), "grantedAt": iso(g.GrantedAt),
	}
}

func (a *API) grantReward(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CampaignID     string `json:"campaignId"`
		UserID         string `json:"userId"`
		Region         string `json:"region"`
		Points         int64  `json:"points"`
		TrustTier      int    `json:"trustTier"`
		IdempotencyKey string `json:"idempotencyKey"`
		HoldID         string `json:"holdId,omitempty"`
		Attestation    struct {
			SessionID    string `json:"sessionId"`
			TermsVersion int    `json:"termsVersion"`
			CompletedAt  string `json:"completedAt"`
			Asked        int    `json:"asked"`
			Correct      int    `json:"correct"`
			Signature    string `json:"signature"`
		} `json:"attestation"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	engine, _, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	completedAt, err := time.Parse(time.RFC3339, body.Attestation.CompletedAt)
	if err != nil {
		a.fail(w, fmt.Errorf("%w: attestation.completedAt is not RFC3339", errBadRequest))
		return
	}
	granted, err := engine.GrantReward(r.Context(), reward.RewardRequest{
		CampaignID: body.CampaignID, UserID: body.UserID, Points: body.Points, TrustTier: body.TrustTier,
		IdempotencyKey: body.IdempotencyKey, HoldID: body.HoldID,
		Completion: attest.Completion{
			SessionID: body.Attestation.SessionID, UserID: body.UserID, CampaignID: body.CampaignID,
			TermsVersion: body.Attestation.TermsVersion, CompletedAt: completedAt,
			Asked: body.Attestation.Asked, Correct: body.Attestation.Correct,
		},
		Signature: body.Attestation.Signature,
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, grantView("campaign", body.UserID, granted))
}

func (a *API) grantAction(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Kind           string `json:"kind"`
		UserID         string `json:"userId"`
		Region         string `json:"region"`
		Points         int64  `json:"points"`
		TrustTier      int    `json:"trustTier"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	engine, _, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	granted, err := engine.GrantAction(r.Context(), reward.ActionRequest{
		Kind: body.Kind, UserID: body.UserID, Points: body.Points, TrustTier: body.TrustTier,
		IdempotencyKey: body.IdempotencyKey,
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, grantView(body.Kind, body.UserID, granted))
}

func burnView(b burn.Burn) map[string]any {
	state := "burned"
	if b.Reinstated {
		state = "reinstated"
	}
	return map[string]any{
		"sagaId": b.SagaID, "userId": b.UserID, "listingId": b.ListingID, "points": b.Points,
		"state": state, "burnedAt": iso(b.At),
	}
}

func (a *API) burnForVoucher(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID    string `json:"userId"`
		ListingID string `json:"listingId"`
		Points    int64  `json:"points"`
		SagaID    string `json:"sagaId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	burned, err := a.burns.ForListing(r.Context(), body.SagaID, body.UserID, body.ListingID, body.Points)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, burnView(burned))
}

func (a *API) getBurn(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SagaID string `json:"sagaId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	burned, err := a.burns.Get(r.Context(), body.SagaID)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, burnView(burned))
}

func (a *API) reinstateBurn(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SagaID string `json:"sagaId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	burned, err := a.burns.Reinstate(r.Context(), body.SagaID, "voucher not honoured (K13)")
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, burnView(burned))
}

func (a *API) balance(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID string `json:"userId"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	available, err := a.ledger.Balance(r.Context(), ledger.UserAccountID(body.UserID, ledger.PurposeAvailable))
	if err != nil {
		a.fail(w, err)
		return
	}
	buckets, err := sqlcgen.New(a.pool).PendingBuckets(r.Context(), body.UserID)
	if err != nil {
		a.fail(w, err)
		return
	}
	pending := make([]map[string]any, 0, len(buckets))
	for _, b := range buckets {
		pending = append(pending, map[string]any{"points": b.Points, "unlockAt": iso(b.UnlockAt.Time)})
	}
	// Points expiry is off in both regions (F18), so nothing is expiring.
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"userId": body.UserID, "availablePoints": available, "pending": pending,
		"expiringPoints": 0, "expiringAt": nil,
	})
}

// historyWindow bounds how far back one page looks for its cursor.
const historyWindow = 500

func (a *API) history(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID        string `json:"userId"`
		Limit         int    `json:"limit"`
		StartingAfter string `json:"startingAfter,omitempty"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if body.Limit <= 0 {
		body.Limit = 20
	}
	if body.Limit > 100 {
		a.fail(w, fmt.Errorf("%w: limit is at most 100", errBadRequest))
		return
	}
	rows, err := sqlcgen.New(a.pool).UserHistory(r.Context(), sqlcgen.UserHistoryParams{
		UserID: body.UserID, MaxRows: historyWindow,
	})
	if err != nil {
		a.fail(w, err)
		return
	}
	start := 0
	if body.StartingAfter != "" {
		for i, row := range rows {
			if row.ID == body.StartingAfter {
				start = i + 1
				break
			}
		}
	}
	entries := make([]map[string]any, 0, body.Limit)
	for _, row := range rows[min(start, len(rows)):] {
		if len(entries) == body.Limit {
			break
		}
		entries = append(entries, map[string]any{
			"id": row.ID, "kind": row.Kind, "points": row.Points, "externalRef": row.ExternalRef,
			"campaignId": uuidOrNil(row.CampaignID), "listingId": uuidOrNil(row.ListingID), "voucherId": nil,
			"at": iso(row.At.Time),
		})
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, entries)
}

func uuidOrNil(id pgtype.UUID) any {
	if !id.Valid {
		return nil
	}
	b := id.Bytes
	return strings.ToLower(fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]))
}
