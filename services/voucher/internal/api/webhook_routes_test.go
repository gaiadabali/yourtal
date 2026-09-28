package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/api"
	"github.com/yourtal/services/voucher/internal/serviceauth"
	"github.com/yourtal/services/voucher/internal/testdb"
)

// 8.3.e: apps/worker's poll-then-acknowledge pair over voucher.webhook_outbox
// (webhook_routes.go), the same round-trip-over-real-Postgres style ledger's
// release_routes_test.go uses for the identical unnotified/notified shape.
// Neither the minter nor the redemption network is exercised by these two
// routes, so `api.New` gets real nils for them (auth_walk_test.go already
// proves that is safe for routing purposes; here the handlers never touch
// them).

type webhookServer struct {
	t       *testing.T
	handler http.Handler
	pool    *pgxpool.Pool
}

func newWebhookServer(t *testing.T) *webhookServer {
	t.Helper()
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, testdb.URL(t, "VOUCHER_DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("no local Postgres (run `pnpm dev:up`): %v", err)
	}
	t.Cleanup(pool.Close)

	auth, err := serviceauth.New(secret)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := chi.NewRouter()
	router.Use(middleware.Recoverer)
	router.Route("/internal/v1", func(r chi.Router) {
		r.Use(auth.Middleware(logger))
		r.Mount("/", api.New(logger, pool, nil, nil, nil).Routes())
	})
	return &webhookServer{t: t, handler: router, pool: pool}
}

func (s *webhookServer) call(path string, body any, out any) int {
	s.t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		s.t.Fatalf("marshalling %s's body: %v", path, err)
	}
	req := httptest.NewRequest(http.MethodPost, "/internal/v1"+path, bytes.NewReader(payload))
	req.Header.Set(serviceauth.Header,
		serviceauth.Sign(secret, "worker", unique("n"), http.MethodPost, "/internal/v1"+path, payload, time.Now()))
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, req)
	if out != nil && rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			s.t.Fatalf("%s answered %d %s: %v", path, rec.Code, rec.Body.String(), err)
		}
	}
	return rec.Code
}

func (s *webhookServer) mustCall(path string, body any, out any) {
	s.t.Helper()
	if code := s.call(path, body, out); code != http.StatusOK {
		raw, _ := json.Marshal(out)
		s.t.Fatalf("%s: %d %s", path, code, raw)
	}
}

// insertOutboxRow writes a row the way redeem.RecordWebhookOutbox does,
// directly, so this test does not need a whole capture/refund to exist —
// settle_test.go and release_test.go already prove that half.
func (s *webhookServer) insertOutboxRow(t *testing.T, eventType string, merchantID uuid.UUID, idempotencyKey string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := s.pool.QueryRow(context.Background(),
		`INSERT INTO voucher.webhook_outbox (event_type, merchant_id, idempotency_key, payload)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		eventType, merchantID, idempotencyKey, []byte(`{"ok":true}`)).Scan(&id); err != nil {
		t.Fatalf("seeding an outbox row: %v", err)
	}
	return id
}

type webhookOutboxEvent struct {
	ID             string `json:"id"`
	EventType      string `json:"eventType"`
	MerchantID     string `json:"merchantId"`
	IdempotencyKey string `json:"idempotencyKey"`
	CreatedAt      string `json:"createdAt"`
}

func TestWebhookOutboxIsListedUntilAcknowledged(t *testing.T) {
	s := newWebhookServer(t)
	merchant := uuid.New()

	firstKey, secondKey := unique("capture"), unique("refund")
	firstID := s.insertOutboxRow(t, "voucher.captured", merchant, firstKey)
	secondID := s.insertOutboxRow(t, "voucher.refunded", merchant, secondKey)

	var page struct {
		Events []webhookOutboxEvent `json:"events"`
	}
	s.mustCall("/webhook-events/unposted", map[string]any{"limit": 500}, &page)
	byID := make(map[string]webhookOutboxEvent, len(page.Events))
	for _, event := range page.Events {
		byID[event.ID] = event
	}
	got, ok := byID[firstID.String()]
	if !ok {
		t.Fatalf("the seeded capture event is not listed")
	}
	if got.EventType != "voucher.captured" || got.MerchantID != merchant.String() || got.IdempotencyKey != firstKey {
		t.Errorf("event %+v", got)
	}
	if _, ok := byID[secondID.String()]; !ok {
		t.Fatalf("the seeded refund event is not listed")
	}

	var ack struct {
		Acknowledged int64 `json:"acknowledged"`
	}
	s.mustCall("/webhook-events/posted", map[string]any{"ids": []string{firstID.String()}}, &ack)
	if ack.Acknowledged != 1 {
		t.Errorf("acknowledged %d, want 1", ack.Acknowledged)
	}

	s.mustCall("/webhook-events/unposted", map[string]any{"limit": 500}, &page)
	byID = make(map[string]webhookOutboxEvent, len(page.Events))
	for _, event := range page.Events {
		byID[event.ID] = event
	}
	if _, ok := byID[firstID.String()]; ok {
		t.Error("an acknowledged event is still listed")
	}
	if _, ok := byID[secondID.String()]; !ok {
		t.Error("the unacknowledged refund event was dropped")
	}

	// A repeat acknowledgement is a no-op, not an error — the same guarantee
	// release_routes_test.go proves for the ledger's identical shape.
	s.mustCall("/webhook-events/posted", map[string]any{"ids": []string{firstID.String()}}, &ack)
	if ack.Acknowledged != 0 {
		t.Errorf("a repeat acknowledged %d, want 0", ack.Acknowledged)
	}
}

func TestWebhookOutboxPostedRefusesAnEmptyOrOversizedBatch(t *testing.T) {
	s := newWebhookServer(t)
	var p struct {
		Code string `json:"code"`
	}
	if code := s.call("/webhook-events/posted", map[string]any{"ids": []string{}}, &p); code != http.StatusBadRequest {
		t.Errorf("an empty batch: %d, want 400", code)
	}
	ids := make([]string, 501)
	for i := range ids {
		ids[i] = uuid.NewString()
	}
	if code := s.call("/webhook-events/posted", map[string]any{"ids": ids}, &p); code != http.StatusBadRequest {
		t.Errorf("a 501-id batch: %d, want 400", code)
	}
}
