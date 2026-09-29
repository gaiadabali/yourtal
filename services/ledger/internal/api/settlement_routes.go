package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/settlement"
)

// 10.1's clearing & settlement group, and 10.5.b's capture recovery. B's
// staff console and studio billing (10.6) reach these through apps/api's
// LedgerInternalClient, never directly.

// generateStatement is worker-only (10.1.b, apps/worker's weekly job): the
// one route that computes a NEW statement, because it is the one caller
// that knows a business's region without having to infer it. Everyone else
// only lists what this has already generated.
func (a *API) generateStatement(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BusinessID string `json:"businessId"`
		Region     string `json:"region"`
		From       string `json:"from"`
		To         string `json:"to"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	_, region, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	from, to, ok := a.parsePeriod(w, body.From, body.To)
	if !ok {
		return
	}
	if body.BusinessID == "" {
		a.fail(w, fmt.Errorf("%w: businessId is required", errBadRequest))
		return
	}
	stmt, err := a.settlement.GenerateOrGet(r.Context(), body.BusinessID, region, from, to)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, statementJSON(stmt))
}

// statements is the contract's list op (packages/contracts/src/ledger-internal/economy.ts):
// every statement already generated for a business whose period falls
// inside [from, to). Never generates — see generateStatement.
func (a *API) statements(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BusinessID string `json:"businessId"`
		From       string `json:"from"`
		To         string `json:"to"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	from, to, ok := a.parsePeriod(w, body.From, body.To)
	if !ok {
		return
	}
	if body.BusinessID == "" {
		a.fail(w, fmt.Errorf("%w: businessId is required", errBadRequest))
		return
	}
	list, err := a.settlement.ListForBusiness(r.Context(), body.BusinessID, from, to)
	if err != nil {
		a.fail(w, err)
		return
	}
	answer := make([]map[string]any, 0, len(list))
	for _, stmt := range list {
		answer = append(answer, statementJSON(stmt))
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, answer)
}

// statementQueue is 10.5/10.6's staff queue: every open or disputed
// statement in a region, oldest first.
func (a *API) statementQueue(w http.ResponseWriter, r *http.Request) {
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
	list, err := a.settlement.ListQueue(r.Context(), region)
	if err != nil {
		a.fail(w, err)
		return
	}
	answer := make([]map[string]any, 0, len(list))
	for _, stmt := range list {
		answer = append(answer, statementJSON(stmt))
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, answer)
}

// disputeStatement is 10.6.b's studio call: POST
// /api/:tenantId/studio/billing/statements/:id/dispute reaches here through
// apps/api. Holds the payout until staff resolve it (10.6.a/10.6.c).
func (a *API) disputeStatement(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StatementID string `json:"statementId"`
		Reason      string `json:"reason"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	stmt, err := a.settlement.Dispute(r.Context(), body.StatementID, body.Reason)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, statementJSON(stmt))
}

// resolveStatementDispute is 10.5.a: staff releases a disputed statement
// back to `open`. The resolution itself — e.g. a K13 recovery line — is
// posted separately (see recoverCapture below), onto whichever statement
// covers its own date.
func (a *API) resolveStatementDispute(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StatementID string `json:"statementId"`
		Note        string `json:"note"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	stmt, err := a.settlement.Resolve(r.Context(), body.StatementID, body.Note)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, statementJSON(stmt))
}

// approvePayout is 10.1.c: after the F12 dispute window, the statement's
// closing payable moves from the merchant's payable to the reserve.
func (a *API) approvePayout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StatementID string `json:"statementId"`
		ApprovedBy  string `json:"approvedBy"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if body.StatementID == "" || body.ApprovedBy == "" {
		a.fail(w, fmt.Errorf("%w: statementId and approvedBy are required", errBadRequest))
		return
	}
	stmt, err := a.settlement.ApprovePayout(r.Context(), body.StatementID, body.ApprovedBy, time.Now())
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, statementJSON(stmt))
}

// recoverCapture is 10.5.b: resolving a captured-voucher K13 dispute in the
// user's favour posts a recovery line against the merchant that captured it
// — the call B's staff dispute-resolution route makes.
func (a *API) recoverCapture(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CaptureID string `json:"captureId"`
		Reason    string `json:"reason"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	recovery, err := a.settlement.PostCaptureRecovery(r.Context(), body.CaptureID, body.Reason)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{
		"id": recovery.ID, "captureId": recovery.CaptureID, "region": string(recovery.Region),
		"merchantId": recovery.MerchantID, "amountMinor": recovery.AmountMinor, "currency": recovery.Currency,
		"reason": recovery.Reason, "transferId": recovery.TransferID, "postedAt": iso(recovery.At),
	})
}

// releaseVoucherLiability is 10.1.c/10.2.b's other half: an expired voucher
// or a forfeited remainder never captured releases its own S back. The
// caller (the voucher expiry job) owns the idempotency key.
func (a *API) releaseVoucherLiability(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IdempotencyKey string `json:"idempotencyKey"`
		Region         string `json:"region"`
		AmountMinor    int64  `json:"amountMinor"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	_, region, ok := a.engineFor(w, body.Region)
	if !ok {
		return
	}
	transferID, err := a.settlement.ReleaseVoucherLiability(r.Context(), body.IdempotencyKey, region, body.AmountMinor)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"transferId": transferID})
}

// parsePeriod reads an instant either as RFC3339 or as a bare date (the
// contract's `z.iso.date()`), the latter read as that day's UTC midnight —
// from/to are exclusive-end instants either way.
func (a *API) parsePeriod(w http.ResponseWriter, from, to string) (time.Time, time.Time, bool) {
	fromT, ok := parseInstant(from)
	toT, okTo := parseInstant(to)
	if !ok || !okTo {
		a.fail(w, fmt.Errorf("%w: from and to must be RFC3339 timestamps or dates", errBadRequest))
		return time.Time{}, time.Time{}, false
	}
	if !toT.After(fromT) {
		a.fail(w, fmt.Errorf("%w: to must be after from", errBadRequest))
		return time.Time{}, time.Time{}, false
	}
	return fromT, toT, true
}

func parseInstant(value string) (time.Time, bool) {
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t, true
	}
	if t, err := time.Parse(time.DateOnly, value); err == nil {
		return t, true
	}
	return time.Time{}, false
}

func statementJSON(s settlement.Statement) map[string]any {
	return map[string]any{
		"id": s.ID, "businessId": s.BusinessID, "region": string(s.Region), "currency": s.Currency,
		"periodFrom": iso(s.PeriodFrom), "periodTo": iso(s.PeriodTo),
		"openingPayableMinor": s.OpeningPayableMinor, "capturesMinor": s.CapturesMinor,
		"refundsMinor": s.RefundsMinor, "recoveriesMinor": s.RecoveriesMinor,
		"closingPayableMinor": s.ClosingPayableMinor, "pointPurchasesMinor": s.PointPurchasesMinor,
		"pointPurchasesPoints": s.PointPurchasesPoints, "status": s.Status,
		"disputeReason": s.DisputeReason, "disputedAt": isoOrNil(s.DisputedAt),
		"resolutionNote": s.ResolutionNote, "resolvedAt": isoOrNil(s.ResolvedAt),
		"disputeWindowEndsAt": iso(s.DisputeWindowEndsAt), "generatedAt": iso(s.GeneratedAt),
		"approvedBy": s.ApprovedBy, "approvedAt": isoOrNil(s.ApprovedAt), "payoutTransferId": s.PayoutTransferID,
	}
}

func isoOrNil(t *time.Time) *string {
	if t == nil {
		return nil
	}
	v := iso(*t)
	return &v
}
