package redeem_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/yourtal/services/voucher/internal/ledgerpost"
	"github.com/yourtal/services/voucher/internal/redeem"
	"github.com/yourtal/services/voucher/internal/serviceauth"
)

// 4.6.f.2: the outbox drainer posts each capture to the ledger once, over
// signed HTTP as "voucher", and survives the ledger being down.

var ledgerSecret = []byte("test-only-ledger-service-secret-32b")

// fakeLedger checks each signature and counts posts per capture id.
type fakeLedger struct {
	mu       sync.Mutex
	down     bool
	posts    map[string]int
	bodies   map[string]map[string]any
	badCalls int
}

func (f *fakeLedger) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	defer f.mu.Unlock()
	fields := map[string]string{}
	for _, part := range strings.Split(r.Header.Get(serviceauth.Header), ",") {
		if k, v, ok := strings.Cut(part, "="); ok {
			fields[k] = v
		}
	}
	unix, _ := strconv.ParseInt(fields["t"], 10, 64)
	want := serviceauth.Sign(ledgerSecret, "voucher", fields["n"], r.Method, r.URL.RequestURI(), body, time.Unix(unix, 0))
	if r.URL.Path != "/v1/captures" || r.Header.Get(serviceauth.Header) != want {
		f.badCalls++
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if f.down {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	var capture map[string]any
	_ = json.Unmarshal(body, &capture)
	id, _ := capture["captureId"].(string)
	f.posts[id]++
	f.bodies[id] = capture
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{}`))
}

func TestTheOutboxIsPostedToTheLedgerOnceAndSurvivesItBeingDown(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 20_000, Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}
	captured, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 20_000, "rcpt_poster_test")
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}
	captureID := captured.ID.String()

	ledger := &fakeLedger{down: true, posts: map[string]int{}, bodies: map[string]map[string]any{}}
	server := httptest.NewServer(ledger)
	defer server.Close()
	poster, err := ledgerpost.New(f.pool, server.URL, ledgerSecret, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}

	// The ledger is down: nothing is marked posted.
	if _, err := poster.DrainOnce(ctx); err == nil {
		t.Fatal("a down ledger drained without an error")
	}
	if postedAt(t, f, captureID) {
		t.Fatal("the row was marked posted although the ledger answered 503")
	}

	// It comes back: the row is posted and marked, as the right capture.
	ledger.mu.Lock()
	ledger.down = false
	ledger.mu.Unlock()
	for range 20 {
		if _, err := poster.DrainOnce(ctx); err != nil {
			t.Fatalf("drain: %v", err)
		}
		if postedAt(t, f, captureID) {
			break
		}
	}
	if !postedAt(t, f, captureID) {
		t.Fatal("the row was never marked posted")
	}
	body := ledger.bodies[captureID]
	if body["region"] != "ID" || body["currency"] != "IDR" || body["amountMinor"] != float64(20_000) ||
		body["merchantId"] != f.merchantID.String() {
		t.Fatalf("posted %v", body)
	}

	// Posted once; later passes never send it again.
	if _, err := poster.DrainOnce(ctx); err != nil {
		t.Fatalf("drain: %v", err)
	}
	if ledger.posts[captureID] != 1 || ledger.badCalls != 0 {
		t.Fatalf("posts = %d, bad calls = %d; want 1 and 0", ledger.posts[captureID], ledger.badCalls)
	}
}

func postedAt(t *testing.T, f *fixture, captureID string) bool {
	t.Helper()
	var posted bool
	if err := f.pool.QueryRow(context.Background(),
		`SELECT posted_at IS NOT NULL FROM voucher.capture_outbox WHERE capture_id = $1`, captureID).Scan(&posted); err != nil {
		t.Fatalf("reading the outbox row: %v", err)
	}
	return posted
}
