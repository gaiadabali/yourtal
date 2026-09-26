package api_test

import (
	"net/http"
	"testing"
)

// 9.4.b over HTTP: escrow takes available then pending, the balance shows
// neither, and the release puts both back.
func TestEscrowRoundTrip(t *testing.T) {
	s := newServer(t)
	s.mustCall("/economy/marketing/fund", map[string]any{"region": "AU", "amountMinor": 100_000,
		"proposedBy": "alice", "approvedBy": "bob"}, nil)
	s.mustCall("/allocations/purchase", map[string]any{"businessId": uuid(), "region": "AU", "currency": "AUD",
		"points": 10_000, "paidMinor": 45_000, "idempotencyKey": unique("buy")}, nil)
	user := uuid()
	for _, tier := range []int{3, 0} {
		s.mustCall("/actions/grants", map[string]any{"kind": "goodwill", "userId": user, "region": "AU",
			"points": 100, "trustTier": tier, "idempotencyKey": unique("goodwill")}, nil)
	}

	type escrowed struct {
		EscrowID string `json:"escrowId"`
		UserID   string `json:"userId"`
		Points   int64  `json:"points"`
		State    string `json:"state"`
	}
	type balance struct {
		AvailablePoints int64 `json:"availablePoints"`
		Pending         []struct {
			Points int64 `json:"points"`
		} `json:"pending"`
	}
	read := func() (int64, int64) {
		var b balance
		s.mustCall("/wallet/balance", map[string]any{"userId": user}, &b)
		var pending int64
		for _, bucket := range b.Pending {
			pending += bucket.Points
		}
		return b.AvailablePoints, pending
	}
	if a, p := read(); a != 100 || p != 100 {
		t.Fatalf("before: available %d, pending %d", a, p)
	}

	key := unique("escrow")
	var held escrowed
	s.mustCall("/escrow", map[string]any{"userId": user, "points": 130, "reason": "suspended", "idempotencyKey": key}, &held)
	if held.State != "held" || held.Points != 130 || held.UserID != user {
		t.Fatalf("escrow %+v", held)
	}
	var replay escrowed
	s.mustCall("/escrow", map[string]any{"userId": user, "points": 130, "reason": "suspended", "idempotencyKey": key}, &replay)
	if replay.EscrowID != held.EscrowID {
		t.Errorf("a replay made %s, want %s", replay.EscrowID, held.EscrowID)
	}
	if a, p := read(); a != 0 || p != 70 {
		t.Fatalf("while held: available %d, pending %d; want 0 and 70", a, p)
	}

	var problemBody problem
	if code := s.call("/escrow", map[string]any{"userId": user, "points": 71, "reason": "suspended"}, &problemBody); code != http.StatusConflict || problemBody.Code != "insufficient_available" {
		t.Errorf("an escrow beyond the balance answered %d %s", code, problemBody.Code)
	}
	if code := s.call("/escrow/release", map[string]any{"escrowId": "esc_nope"}, nil); code != http.StatusNotFound {
		t.Errorf("an unknown escrow answered %d, want 404", code)
	}

	var released escrowed
	s.mustCall("/escrow/release", map[string]any{"escrowId": held.EscrowID}, &released)
	if released.State != "released" {
		t.Fatalf("release %+v", released)
	}
	if a, p := read(); a != 100 || p != 100 {
		t.Fatalf("after release: available %d, pending %d; want 100 and 100", a, p)
	}
}
