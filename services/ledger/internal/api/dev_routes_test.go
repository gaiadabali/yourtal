package api_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/go-chi/chi/v5"

	"github.com/yourtal/services/ledger/internal/api"
	"github.com/yourtal/services/ledger/internal/serviceauth"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// newDevServer is newServer (api_test.go) with EnableDevRoutes(true) — the
// shape cmd/ledger/main.go builds when APP_ENV is "dev" or "staging".
func newDevServer(t *testing.T) *server {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	owner, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	auth, err := serviceauth.New(secret)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := chi.NewRouter()
	router.Route("/v1", func(r chi.Router) {
		r.Use(auth.Middleware(logger))
		r.Mount("/", api.New(logger, pool, attestationSecret).EnableDevRoutes(true).Routes())
	})
	return &server{t: t, handler: router, owner: owner}
}

// fund grants a tier-0 (72h holdback) goodwill grant to a fresh user and
// returns their id — the same funding shape TestEscrowRoundTrip already uses.
func (s *server) fundPendingGrant(t *testing.T, points int) string {
	t.Helper()
	s.mustCall("/economy/marketing/fund", map[string]any{"region": "AU", "amountMinor": 100_000,
		"proposedBy": "alice", "approvedBy": "bob"}, nil)
	s.mustCall("/allocations/purchase", map[string]any{"businessId": uuid(), "region": "AU", "currency": "AUD",
		"points": 10_000, "paidMinor": 45_000, "idempotencyKey": unique("buy")}, nil)
	user := uuid()
	s.mustCall("/actions/grants", map[string]any{"kind": "goodwill", "userId": user, "region": "AU",
		"points": points, "trustTier": 0, "idempotencyKey": unique("goodwill")}, nil)
	return user
}

func (s *server) walletBalance(user string) (available int64, pending int64) {
	s.t.Helper()
	var b struct {
		AvailablePoints int64 `json:"availablePoints"`
		Pending         []struct {
			Points int64 `json:"points"`
		} `json:"pending"`
	}
	s.mustCall("/wallet/balance", map[string]any{"userId": user}, &b)
	for _, bucket := range b.Pending {
		pending += bucket.Points
	}
	return b.AvailablePoints, pending
}

// Outside dev/staging (main.go never calls EnableDevRoutes), the route
// answers 404 — not merely refused — so a production deployment does not
// reveal it exists.
func TestAdvanceHoldbackDisabledOutsideDevStaging(t *testing.T) {
	s := newServer(t) // devEnabled defaults false, same as production
	if code := s.call("/dev/advance-holdback", map[string]any{"userId": uuid(), "days": 1}, nil); code != http.StatusNotFound {
		t.Fatalf("disabled dev route: %d, want 404", code)
	}
}

// The 2.3.f Check itself: a tier-0 grant is pending (72h holdback); the dev
// route shifts it due and releases it, and the wallet moves the points from
// pending to available. A second, identical call is a no-op.
func TestAdvanceHoldbackShiftsAndReleasesAPendingGrant(t *testing.T) {
	s := newDevServer(t)
	user := s.fundPendingGrant(t, 40)
	if a, p := s.walletBalance(user); a != 0 || p != 40 {
		t.Fatalf("before: available %d, pending %d; want 0 and 40", a, p)
	}

	var first struct {
		Shifted    int  `json:"shifted"`
		Released   int  `json:"released"`
		EscrowHeld bool `json:"escrowHeld"`
	}
	s.mustCall("/dev/advance-holdback", map[string]any{"userId": user, "releaseNow": true}, &first)
	if first.Shifted != 1 || first.Released != 1 || first.EscrowHeld {
		t.Fatalf("first call: %+v", first)
	}
	if a, p := s.walletBalance(user); a != 40 || p != 0 {
		t.Fatalf("after: available %d, pending %d; want 40 and 0", a, p)
	}

	// Idempotent: nothing left to shift or release.
	var second struct {
		Shifted    int  `json:"shifted"`
		Released   int  `json:"released"`
		EscrowHeld bool `json:"escrowHeld"`
	}
	s.mustCall("/dev/advance-holdback", map[string]any{"userId": user, "releaseNow": true}, &second)
	if second.Shifted != 0 || second.Released != 0 {
		t.Fatalf("second call: %+v, want zero", second)
	}
}

// "Advance N days" moves unlock_at N days earlier rather than straight to
// now — a grant less than N days from due becomes due; the same shape
// apps/api's fake-mode dev-clock uses.
func TestAdvanceHoldbackByDays(t *testing.T) {
	s := newDevServer(t)
	user := s.fundPendingGrant(t, 25)

	var result struct {
		Shifted  int `json:"shifted"`
		Released int `json:"released"`
	}
	s.mustCall("/dev/advance-holdback", map[string]any{"userId": user, "days": 4}, &result)
	if result.Shifted != 1 || result.Released != 1 {
		t.Fatalf("advance by days: %+v", result)
	}
	if a, p := s.walletBalance(user); a != 25 || p != 0 {
		t.Fatalf("after: available %d, pending %d; want 25 and 0", a, p)
	}
}

// A held escrow keeps the user's pending points pending (4.4.g): the shift
// still moves unlock_at earlier, but release skips them, and escrowHeld says
// so rather than silently releasing zero with no explanation.
func TestAdvanceHoldbackSkipsAUserWithHeldEscrow(t *testing.T) {
	s := newDevServer(t)
	user := s.fundPendingGrant(t, 50)
	// A tier-3 (no holdback) grant funds something to escrow.
	s.mustCall("/actions/grants", map[string]any{"kind": "goodwill", "userId": user, "region": "AU",
		"points": 10, "trustTier": 3, "idempotencyKey": unique("goodwill")}, nil)

	var held struct {
		EscrowID string `json:"escrowId"`
	}
	s.mustCall("/escrow", map[string]any{"userId": user, "points": 10, "reason": "suspended",
		"idempotencyKey": unique("escrow")}, &held)

	var result struct {
		Shifted    int  `json:"shifted"`
		Released   int  `json:"released"`
		EscrowHeld bool `json:"escrowHeld"`
	}
	s.mustCall("/dev/advance-holdback", map[string]any{"userId": user, "releaseNow": true}, &result)
	if result.Shifted != 1 {
		t.Fatalf("shifted: %+v, want 1", result)
	}
	if result.Released != 0 || !result.EscrowHeld {
		t.Fatalf("with a held escrow: %+v, want released 0 and escrowHeld true", result)
	}
	if _, p := s.walletBalance(user); p != 50 {
		t.Fatalf("pending %d, want 50 (still held back, only shifted)", p)
	}

	s.mustCall("/escrow/release", map[string]any{"escrowId": held.EscrowID}, nil)
	s.mustCall("/dev/advance-holdback", map[string]any{"userId": user, "releaseNow": true}, &result)
	if result.Released != 1 || result.EscrowHeld {
		t.Fatalf("after the escrow is released: %+v", result)
	}
}

// A bad request (no userId) is refused before anything is queried.
func TestAdvanceHoldbackRefusesAMissingUserID(t *testing.T) {
	s := newDevServer(t)
	if code := s.call("/dev/advance-holdback", map[string]any{"days": 1}, nil); code != http.StatusBadRequest {
		t.Fatalf("missing userId: %d, want 400", code)
	}
	if code := s.call("/dev/advance-holdback", map[string]any{"userId": uuid(), "days": 0}, nil); code != http.StatusBadRequest {
		t.Fatalf("days=0 without releaseNow: %d, want 400", code)
	}
}
