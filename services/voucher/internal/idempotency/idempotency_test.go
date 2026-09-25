package idempotency_test

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/idempotency"
	"github.com/yourtal/services/voucher/internal/merchantauth"
	"github.com/yourtal/services/voucher/internal/testdb"
)

// The Go-side interceptor against the shared platform.idempotency table
// (YT-0039), driven against real Postgres — the same reasoning as
// `internal/redeem`'s fixture: the invariants here (one claim wins a race,
// a replay never re-runs the handler, a mismatched body is refused) are
// database behaviour, and a fake would only prove the code calls something.

func discardLogger() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }

type harness struct {
	interceptor *idempotency.Interceptor
	calls       int32 // how many times the wrapped handler actually ran
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	ctx := context.Background()

	url := testdb.URL(t, "VOUCHER_DATABASE_URL")
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("no local Postgres (run `pnpm dev:up`): %v", err)
	}
	t.Cleanup(pool.Close)

	return &harness{interceptor: idempotency.New(pool)}
}

// wrap builds the protected handler: a merchant already in context (this
// middleware runs BEHIND auth — see the package comment), a counter of how
// many times the real work ran, and a response worth telling apart from a
// zero value.
func (h *harness) wrap(status int, respond string) http.Handler {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&h.calls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(respond))
	})
	return h.interceptor.Middleware(discardLogger())(inner)
}

func (h *harness) request(handler http.Handler, merchantID uuid.UUID, key string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/vouchers/authorize", bytes.NewReader(body))
	if key != "" {
		req.Header.Set(idempotency.HeaderKey, key)
	}
	req = req.WithContext(merchantauth.WithMerchantID(req.Context(), merchantID))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestAMissingKeyIsRefused(t *testing.T) {
	h := newHarness(t)
	handler := h.wrap(http.StatusOK, `{"ok":true}`)

	rec := h.request(handler, uuid.New(), "", []byte(`{}`))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if atomic.LoadInt32(&h.calls) != 0 {
		t.Fatal("the handler ran with no idempotency key presented")
	}
}

// TestTheSameKeyAndBodyReplaysWithoutRerunningTheHandler is the required
// break-it proof: the same call twice with the same idempotency key must
// return the first result — a SECOND HOLD would mean the handler ran twice.
func TestTheSameKeyAndBodyReplaysWithoutRerunningTheHandler(t *testing.T) {
	h := newHarness(t)
	handler := h.wrap(http.StatusOK, `{"authorization_id":"only-one-of-these-should-ever-be-created"}`)

	merchantID := uuid.New()
	key := uuid.NewString()
	body := []byte(`{"code":"ABCD1234EFGH5678K","amount":1000}`)

	first := h.request(handler, merchantID, key, body)
	second := h.request(handler, merchantID, key, body)

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("status = %d, %d; want 200, 200", first.Code, second.Code)
	}
	if first.Body.String() != second.Body.String() {
		t.Fatalf("a replay returned a different body:\n  first:  %s\n  second: %s",
			first.Body.String(), second.Body.String())
	}
	if second.Header().Get(idempotency.ReplayHeader) != "true" {
		t.Error("the replayed response is not marked Idempotent-Replay: true")
	}
	if calls := atomic.LoadInt32(&h.calls); calls != 1 {
		t.Fatalf("the wrapped handler ran %d times for one idempotency key; want 1 "+
			"(a second run is a second hold)", calls)
	}
}

// TestTheSameKeyWithADifferentBodyIsRefused: docs/13 section 5 — reusing a
// key with different parameters is a 409, not a silent replay of the wrong
// answer and not a second execution.
func TestTheSameKeyWithADifferentBodyIsRefused(t *testing.T) {
	h := newHarness(t)
	handler := h.wrap(http.StatusOK, `{"ok":true}`)

	merchantID := uuid.New()
	key := uuid.NewString()

	first := h.request(handler, merchantID, key, []byte(`{"amount":1000}`))
	second := h.request(handler, merchantID, key, []byte(`{"amount":9999999}`))

	if first.Code != http.StatusOK {
		t.Fatalf("the first request status = %d, want 200", first.Code)
	}
	if second.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 — a reused key with a different body was not refused", second.Code)
	}
	if calls := atomic.LoadInt32(&h.calls); calls != 1 {
		t.Fatalf("the wrapped handler ran %d times; the second (mismatched) call must not run it", calls)
	}
}

// TestDifferentIdempotencyKeysReachTheVoucherConstraintNotAServiceCheck is
// the required proof for the second break-it scenario: two DIFFERENT
// idempotency keys must both reach the handler — idempotency scopes on
// (merchant, key), and it must never suppress a genuinely distinct request,
// which is what would happen if the interceptor collapsed different keys
// together. What stops the SECOND hold is `internal/redeem`'s own
// `authorization_one_live_hold_per_voucher` partial index
// (`TestOneVoucherCannotBeHeldTwice`, adversarial_test.go) — not this
// package, which has no idea what a voucher is.
func TestDifferentIdempotencyKeysBothReachTheHandler(t *testing.T) {
	h := newHarness(t)
	handler := h.wrap(http.StatusOK, `{"ok":true}`)

	merchantID := uuid.New()
	body := []byte(`{"code":"ABCD1234EFGH5678K","amount":1000}`)

	first := h.request(handler, merchantID, uuid.NewString(), body)
	second := h.request(handler, merchantID, uuid.NewString(), body)

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("status = %d, %d; want 200, 200 — a different key must not be refused "+
			"by this layer", first.Code, second.Code)
	}
	if calls := atomic.LoadInt32(&h.calls); calls != 2 {
		t.Fatalf("the handler ran %d times for two distinct keys; want 2", calls)
	}
}

// TestAConcurrentInFlightRequestOnTheSameKeyIsRefused: docs/13 section 5 —
// a second request racing the first, before the first has completed, gets a
// 409 rather than running the handler a second time or blocking forever.
func TestAConcurrentInFlightRequestOnTheSameKeyIsRefused(t *testing.T) {
	h := newHarness(t)

	release := make(chan struct{})
	entered := make(chan struct{}, 1)
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&h.calls, 1)
		entered <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	handler := h.interceptor.Middleware(discardLogger())(inner)

	merchantID := uuid.New()
	key := uuid.NewString()
	body := []byte(`{"amount":1000}`)

	var wg sync.WaitGroup
	var first *httptest.ResponseRecorder
	wg.Add(1)
	go func() {
		defer wg.Done()
		first = h.request(handler, merchantID, key, body)
	}()

	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the first request never reached the handler")
	}

	second := h.request(handler, merchantID, key, body)
	close(release)
	wg.Wait()

	if second.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 — a concurrent in-flight request was not refused", second.Code)
	}
	if first.Code != http.StatusOK {
		t.Fatalf("the original request's own status = %d, want 200", first.Code)
	}
	if calls := atomic.LoadInt32(&h.calls); calls != 1 {
		t.Fatalf("the handler ran %d times; the concurrent request must not have run it", calls)
	}
}
