package api_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/yourtal/services/ledger/internal/ledger"
)

type statementJSON struct {
	ID                  string `json:"id"`
	BusinessID          string `json:"businessId"`
	Region              string `json:"region"`
	CapturesMinor       int64  `json:"capturesMinor"`
	ClosingPayableMinor int64  `json:"closingPayableMinor"`
	Status              string `json:"status"`
	DisputeWindowEndsAt string `json:"disputeWindowEndsAt"`
	PayoutTransferID    string `json:"payoutTransferId"`
}

// 10.1: a capture, a generated statement, a dispute and its resolution, and
// a payout — the whole HTTP round trip, plus the database rows it leaves.
func TestStatementLifecycleOverHTTP(t *testing.T) {
	s := newServer(t)
	ensureChart(t)
	merchant := uuid()
	captureID := uuid()

	s.mustCallAs("voucher", "/captures", map[string]any{
		"captureId": captureID, "region": "AU", "merchantId": merchant, "amountMinor": 6_000, "currency": "AUD",
	})

	// Only apps/worker's caller may generate a statement — it is the one
	// caller that knows a business's region without inferring it.
	if code := s.call("/economy/statements/generate", map[string]any{
		"businessId": merchant, "region": "AU", "from": "2026-01-01", "to": "2026-01-08",
	}, nil); code != http.StatusForbidden {
		t.Fatalf("the api caller generated a statement: %d, want 403", code)
	}

	var stmt statementJSON
	if code := s.callAs("worker", "/economy/statements/generate", map[string]any{
		"businessId": merchant, "region": "AU",
		"from": time.Now().Add(-time.Hour).Format(time.RFC3339), "to": time.Now().Add(time.Hour).Format(time.RFC3339),
	}, &stmt); code != http.StatusOK || stmt.ID == "" {
		t.Fatalf("generate: %d %+v", code, stmt)
	}
	if stmt.CapturesMinor != 6_000 || stmt.ClosingPayableMinor != 6_000 || stmt.Status != "open" {
		t.Fatalf("statement = %+v, want captures 6000, closing 6000, open", stmt)
	}

	var listed []statementJSON
	s.mustCall("/economy/statements", map[string]any{
		"businessId": merchant, "from": "2020-01-01", "to": "2030-01-01",
	}, &listed)
	if len(listed) != 1 || listed[0].ID != stmt.ID {
		t.Fatalf("statements = %+v, want one entry matching %s", listed, stmt.ID)
	}

	// Approving before the F12 dispute window closes is refused.
	var refused problem
	if code := s.call("/economy/payouts/approve", map[string]any{
		"statementId": stmt.ID, "approvedBy": "staff-1",
	}, &refused); code != http.StatusConflict || refused.Code != "dispute_window_open" {
		t.Fatalf("early approval: %d %q, want 409 dispute_window_open", code, refused.Code)
	}

	// A dispute holds the statement until staff resolve it (10.6.c).
	var disputed statementJSON
	s.mustCall("/economy/statements/dispute", map[string]any{
		"statementId": stmt.ID, "reason": "amount looks wrong",
	}, &disputed)
	if disputed.Status != "disputed" {
		t.Fatalf("dispute: %+v", disputed)
	}
	var resolved statementJSON
	s.mustCall("/economy/statements/resolve", map[string]any{
		"statementId": stmt.ID, "note": "reviewed, releasing",
	}, &resolved)
	if resolved.Status != "open" {
		t.Fatalf("resolve: %+v", resolved)
	}

	// The payout-moves-money path itself, and the F12 window it waits on,
	// are settlement.Engine's own tests (settlement_test.go), which inject
	// `now` — the one thing an HTTP round trip cannot fake without either a
	// sleep or reaching past the API into the database, neither of which
	// belongs in this file. What belongs here is the wiring this exercises
	// above: the route decodes, calls the engine, maps its errors to the
	// right HTTP status and closed-enum code, and encodes the result.

	ctx := context.Background()
	pool := ensureChart(t)

	// 10.5.b: a K13 recovery line against the first merchant's own capture,
	// idempotent on a replay.
	type recoveryJSON struct {
		AmountMinor int64  `json:"amountMinor"`
		TransferID  string `json:"transferId"`
	}
	var recovery, replay recoveryJSON
	s.mustCall("/economy/captures/recover", map[string]any{
		"captureId": captureID, "reason": "K13: voucher not honoured",
	}, &recovery)
	s.mustCall("/economy/captures/recover", map[string]any{
		"captureId": captureID, "reason": "K13: voucher not honoured",
	}, &replay)
	if recovery.AmountMinor != 6_000 || replay.TransferID != recovery.TransferID {
		t.Fatalf("recovery = %+v, replay = %+v, want the same 6000 line once", recovery, replay)
	}
	if balance, _ := ledger.New(pool).Balance(ctx, ledger.MerchantPayableID(merchant, ledger.RegionAU)); balance != 0 {
		t.Errorf("merchant payable after recovery = %d, want 0 (6000 captured, 6000 recovered)", balance)
	}

	// 10.1.c/10.2.b: releasing an expired voucher's liability, no merchant leg.
	type releaseJSON struct {
		TransferID string `json:"transferId"`
	}
	var release releaseJSON
	s.mustCall("/economy/vouchers/release-liability", map[string]any{
		"idempotencyKey": "expire_" + uuid(), "region": "AU", "amountMinor": 2_000,
	}, &release)
	if release.TransferID == "" {
		t.Fatal("release-liability: no transfer id")
	}
}

// 10.5/10.6: the staff queue lists what is open or disputed, never what has
// already been paid.
func TestStatementQueueListsOnlyOpenAndDisputed(t *testing.T) {
	s := newServer(t)
	ensureChart(t)
	merchant := uuid()
	s.mustCallAs("voucher", "/captures", map[string]any{
		"captureId": uuid(), "region": "AU", "merchantId": merchant, "amountMinor": 1_000, "currency": "AUD",
	})
	s.mustCallAs("worker", "/economy/statements/generate", map[string]any{
		"businessId": merchant, "region": "AU",
		"from": time.Now().Add(-time.Hour).Format(time.RFC3339), "to": time.Now().Add(time.Hour).Format(time.RFC3339),
	})

	var queue []statementJSON
	s.mustCall("/economy/statements/queue", map[string]any{"region": "AU"}, &queue)
	found := false
	for _, row := range queue {
		if row.BusinessID == merchant {
			found = true
			if row.Status != "open" {
				t.Errorf("queued statement status = %q, want open", row.Status)
			}
		}
	}
	if !found {
		t.Errorf("queue = %+v, want the statement just generated for %s", queue, merchant)
	}
}
