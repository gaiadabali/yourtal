package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/api"
	"github.com/yourtal/services/ledger/internal/attest"
	"github.com/yourtal/services/ledger/internal/serviceauth"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// The live ledger-internal routes (4.1.b), over signed HTTP against the real
// database: each case is a round trip plus the state it should leave.

var (
	secret            = []byte("test-only-ledger-service-secret-32b")
	attestationSecret = []byte("test-only-reward-attestation-secret-32")
	counter           atomic.Uint64
)

func unique(prefix string) string {
	return fmt.Sprintf("%s-%d-%d", prefix, time.Now().UnixNano(), counter.Add(1))
}

func uuid() string {
	n := counter.Add(1)
	return fmt.Sprintf("7e57da7a-0000-4000-8000-%012d", time.Now().UnixNano()%1_000_000_000_000+int64(n))
}

type server struct {
	t       *testing.T
	handler http.Handler
	owner   *pgxpool.Pool
}

func newServer(t *testing.T) *server {
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
		r.Mount("/", api.New(logger, pool, attestationSecret).Routes())
	})
	return &server{t: t, handler: router, owner: owner}
}

// call posts a signed request and decodes the answer into out (if non-nil).
func (s *server) call(path string, body any, out any) int {
	s.t.Helper()
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/v1"+path, bytes.NewReader(payload))
	req.Header.Set(serviceauth.Header, serviceauth.Sign(secret, "api", unique("n"), http.MethodPost, "/v1"+path, payload, time.Now()))
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, req)
	if out != nil && rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			s.t.Fatalf("%s answered %d %s: %v", path, rec.Code, rec.Body.String(), err)
		}
	}
	return rec.Code
}

func (s *server) mustCall(path string, body any, out any) {
	s.t.Helper()
	if code := s.call(path, body, out); code != http.StatusOK {
		raw, _ := json.Marshal(out)
		s.t.Fatalf("%s: %d %s", path, code, raw)
	}
}

type problem struct {
	Code string `json:"code"`
}

func TestAnUnsignedCallIsRefused(t *testing.T) {
	s := newServer(t)
	req := httptest.NewRequest(http.MethodPost, "/v1/wallet/balance", bytes.NewReader([]byte(`{"userId":"x"}`)))
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned: %d, want 401", rec.Code)
	}
}

// A campaign's owner buys points, a viewer completes the campaign (attested),
// spends on a voucher, and the voucher is reinstated (K13): every step over
// HTTP, in ID.
func TestTheLedgerRoutesEndToEnd(t *testing.T) {
	s := newServer(t)
	ctx := context.Background()
	user, listing := uuid(), uuid()

	// The studio (C) writes campaigns, terms and reward configs; the ledger
	// only reads them. A seeded ID campaign, made live with 450-point terms.
	var campaign, business string
	if err := s.owner.QueryRow(ctx, `SELECT c.id::text, c.business_id::text FROM campaign.campaigns c
		LEFT JOIN campaign.reward_config r ON r.campaign_id = c.id
		WHERE r.campaign_id IS NULL AND c.region = 'ID' ORDER BY c.id DESC LIMIT 1`).Scan(&campaign, &business); err != nil {
		t.Skipf("no seeded campaign: %v", err)
	}
	var terms int
	if err := s.owner.QueryRow(ctx, `SELECT COALESCE(max(version), 0) + 1 FROM campaign.terms_version WHERE campaign_id = $1`,
		campaign).Scan(&terms); err != nil {
		t.Fatal(err)
	}
	if _, err := s.owner.Exec(ctx, `INSERT INTO campaign.terms_version (campaign_id, version, reward_points, question_count,
		scoring_rule, duration_seconds, effective_from, accuracy_bonus_points) VALUES ($1, $2, 450, 0, 'base_only', 600, now(), 0)`,
		campaign, terms); err != nil {
		t.Fatal(err)
	}
	if _, err := s.owner.Exec(ctx, `UPDATE campaign.campaigns SET lifecycle_state = 'live' WHERE id = $1`, campaign); err != nil {
		t.Fatal(err)
	}

	var alloc struct {
		AllocationID    string `json:"allocationId"`
		RemainingPoints int64  `json:"remainingPoints"`
		Region          string `json:"region"`
	}
	purchase := map[string]any{"businessId": business, "region": "ID", "currency": "IDR", "points": 10_000,
		"paidMinor": 90_000, "idempotencyKey": unique("buy")}
	s.mustCall("/allocations/purchase", purchase, &alloc)
	if alloc.RemainingPoints != 10_000 || alloc.Region != "ID" {
		t.Fatalf("allocation %+v", alloc)
	}
	var replay struct {
		AllocationID string `json:"allocationId"`
	}
	s.mustCall("/allocations/purchase", purchase, &replay)
	if replay.AllocationID != alloc.AllocationID {
		t.Errorf("a repeated purchase key made %s, want %s", replay.AllocationID, alloc.AllocationID)
	}
	if _, err := s.owner.Exec(ctx, `INSERT INTO campaign.reward_config (campaign_id, allocation_id, funder_type,
		max_points_for_campaign, reward_points_per_completion, accuracy_bonus_points) VALUES ($1, $2, 'partner', 100000, 450, 0)`,
		campaign, alloc.AllocationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = s.owner.Exec(context.Background(), `DELETE FROM campaign.reward_config WHERE campaign_id = $1`, campaign)
	})

	grantBody := func(key string) map[string]any {
		completion := attest.Completion{SessionID: unique("session"), UserID: user, CampaignID: campaign,
			TermsVersion: terms, CompletedAt: time.Now().UTC().Truncate(time.Second)}
		return map[string]any{"campaignId": campaign, "userId": user, "region": "ID", "points": 450,
			"trustTier": 3, "idempotencyKey": key, "attestation": map[string]any{
				"sessionId": completion.SessionID, "termsVersion": terms,
				"completedAt": completion.CompletedAt.Format(time.RFC3339), "asked": 0, "correct": 0,
				"signature": attest.Sign(attestationSecret, completion)}}
	}
	var grant struct {
		GrantID string `json:"grantId"`
		Points  int64  `json:"points"`
	}
	s.mustCall("/rewards/grants", grantBody(unique("grant")), &grant)
	var p problem
	if code := s.call("/rewards/grants", grantBody(unique("again")), &p); code != http.StatusConflict || p.Code != "already_granted" {
		t.Errorf("a second session: %d %s", code, p.Code)
	}

	var balance struct {
		AvailablePoints int64 `json:"availablePoints"`
	}
	s.mustCall("/wallet/balance", map[string]any{"userId": user}, &balance)
	if balance.AvailablePoints != 450 {
		t.Fatalf("available = %d, want 450 (tier 3)", balance.AvailablePoints)
	}

	var quote struct {
		QuoteID     string `json:"quoteId"`
		PricePoints int64  `json:"pricePoints"`
	}
	s.mustCall("/pricing/quote", map[string]any{"region": "ID", "currency": "IDR", "settlementMinor": 1_800}, &quote)
	if quote.PricePoints != 300 { // IDR 1,800 at B = IDR 6
		t.Errorf("quote = %d points, want 300", quote.PricePoints)
	}
	var locked struct {
		Locked bool `json:"locked"`
	}
	s.mustCall("/pricing/quote/lock", map[string]any{"quoteId": quote.QuoteID}, &locked)
	if !locked.Locked {
		t.Error("the quote did not lock")
	}
	s.mustCall("/pricing/listing", map[string]any{"listingId": listing, "region": "ID", "currency": "IDR", "settlementMinor": 1_800}, nil)

	saga := unique("saga")
	var burned struct {
		State string `json:"state"`
	}
	s.mustCall("/burns", map[string]any{"userId": user, "listingId": listing, "points": 300, "sagaId": saga}, &burned)
	s.mustCall("/wallet/balance", map[string]any{"userId": user}, &balance)
	if balance.AvailablePoints != 150 || burned.State != "burned" {
		t.Fatalf("after the burn: available %d, state %s", balance.AvailablePoints, burned.State)
	}
	if code := s.call("/burns", map[string]any{"userId": user, "listingId": listing, "points": 300, "sagaId": unique("saga")}, &p); code != http.StatusConflict || p.Code != "insufficient_available" {
		t.Errorf("an overdraw: %d %s", code, p.Code)
	}
	s.mustCall("/burns/reinstate", map[string]any{"sagaId": saga}, &burned)
	s.mustCall("/wallet/balance", map[string]any{"userId": user}, &balance)
	if balance.AvailablePoints != 450 || burned.State != "reinstated" {
		t.Errorf("after reinstatement: available %d, state %s", balance.AvailablePoints, burned.State)
	}

	var history []struct {
		Kind string `json:"kind"`
	}
	s.mustCall("/wallet/history", map[string]any{"userId": user, "limit": 10}, &history)
	if len(history) != 3 || history[0].Kind != "reinstatement" || history[2].Kind != "grant" {
		t.Errorf("history = %+v, want reinstatement, burn, grant", history)
	}

	var coverage struct {
		Ratio float64 `json:"ratio"`
	}
	s.mustCall("/economy/coverage", map[string]any{"region": "ID"}, &coverage)
	if coverage.Ratio <= 0 {
		t.Errorf("coverage ratio %v", coverage.Ratio)
	}
}

func TestRatesAndMarketingNeedTwoPeople(t *testing.T) {
	s := newServer(t)
	var proposal struct {
		ProposalID string `json:"proposalId"`
		State      string `json:"state"`
	}
	// The F1 rate again: approving it moves nothing, so it cannot cut B
	// under another test's feet.
	s.mustCall("/economy/rates/propose", map[string]any{"region": "AU", "currency": "AUD",
		"backingRateMicrosPerPoint": 3_000_000, "proposedBy": "alice"}, &proposal)
	if proposal.State != "pending" {
		t.Fatalf("proposal %+v", proposal)
	}
	// The closed enum has no two-person code; the contract answers already_granted.
	var p problem
	if code := s.call("/economy/rates/approve", map[string]any{"proposalId": proposal.ProposalID, "approvedBy": "alice"}, &p); code != http.StatusConflict || p.Code != "already_granted" {
		t.Errorf("self-approval answered %d %s, want 409 already_granted", code, p.Code)
	}
	s.mustCall("/economy/rates/approve", map[string]any{"proposalId": proposal.ProposalID, "approvedBy": "bob"}, &proposal)
	if proposal.State != "approved" {
		t.Errorf("after approval: %+v", proposal)
	}
	if code := s.call("/economy/marketing/fund", map[string]any{"region": "ID", "amountMinor": 1000,
		"proposedBy": "alice", "approvedBy": "alice"}, &p); code != http.StatusConflict || p.Code != "already_granted" {
		t.Errorf("one-person marketing funding answered %d %s, want 409 already_granted", code, p.Code)
	}
	if code := s.call("/economy/statements", map[string]any{}, nil); code != http.StatusNotImplemented {
		t.Errorf("statements answered %d, want 501 until 10.1", code)
	}
}
