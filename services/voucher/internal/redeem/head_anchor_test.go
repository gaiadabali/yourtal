package redeem_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/yourtal/services/voucher/internal/ledgerpost"
	"github.com/yourtal/services/voucher/internal/redeem"
)

// 4.6.h: each voucher's chain head is anchored in the ledger as it moves,
// and the watermark advances only after the ledger accepted it.

type fakeAnchors struct {
	mu    sync.Mutex
	down  bool
	heads map[string][]map[string]any // voucher id -> heads received
}

func (f *fakeAnchors) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.down {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if r.URL.Path != "/v1/proof/voucher-heads" {
		w.WriteHeader(http.StatusOK) // the capture drain is another test's concern
		return
	}
	var body struct {
		Heads []map[string]any `json:"heads"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	for _, head := range body.Heads {
		id, _ := head["voucherId"].(string)
		f.heads[id] = append(f.heads[id], head)
	}
	w.WriteHeader(http.StatusOK)
}

func (f *fakeAnchors) received(id string) []map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.heads[id]
}

func TestAVouchersChainHeadIsAnchoredOncePerMove(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	id := voucherID.String()

	ledger := &fakeAnchors{down: true, heads: map[string][]map[string]any{}}
	server := httptest.NewServer(ledger)
	defer server.Close()
	poster, err := ledgerpost.New(f.pool, server.URL, ledgerSecret, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	anchorAll := func() {
		t.Helper()
		for range 50 {
			n, err := poster.AnchorOnce(ctx)
			if err != nil {
				t.Fatalf("anchor: %v", err)
			}
			if n == 0 {
				return
			}
		}
	}

	// The ledger is down: nothing is anchored and the watermark stays.
	if _, err := poster.AnchorOnce(ctx); err == nil {
		t.Fatal("a down ledger anchored without an error")
	}
	if watermark(t, f, id) != 0 {
		t.Fatal("the watermark moved although the ledger answered 503")
	}

	ledger.mu.Lock()
	ledger.down = false
	ledger.mu.Unlock()
	anchorAll()
	first := ledger.received(id)
	if len(first) != 1 {
		t.Fatalf("anchored %d heads, want 1", len(first))
	}
	assertHead(t, f, id, first[0])

	// Nothing moved: nothing is re-sent.
	anchorAll()
	if len(ledger.received(id)) != 1 {
		t.Fatal("an unchanged voucher was anchored again")
	}

	// The voucher moves (a hold): its new head is anchored.
	if _, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000, Currency: "IDR", OrderRef: orderRef(),
	}); err != nil {
		t.Fatalf("Authorize: %v", err)
	}
	anchorAll()
	heads := ledger.received(id)
	if len(heads) != 2 {
		t.Fatalf("anchored %d heads after a move, want 2", len(heads))
	}
	assertHead(t, f, id, heads[1])
}

func watermark(t *testing.T, f *fixture, id string) int {
	t.Helper()
	var v int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT head_anchored_version FROM voucher.vouchers WHERE id = $1`, id).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

// assertHead checks a sent head is the chain's latest event and the watermark caught up.
func assertHead(t *testing.T, f *fixture, id string, head map[string]any) {
	t.Helper()
	var seq int
	var hash, region string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT e.seq, e.hash, v.region FROM voucher.event e JOIN voucher.vouchers v ON v.id = e.voucher_id
		  WHERE e.voucher_id = $1 ORDER BY e.seq DESC LIMIT 1`, id).Scan(&seq, &hash, &region); err != nil {
		t.Fatal(err)
	}
	if head["seq"] != float64(seq) || head["headHash"] != hash || head["region"] != region {
		t.Fatalf("sent %v, want seq %d hash %s region %s", head, seq, hash, region)
	}
	if watermark(t, f, id) != seq {
		t.Fatalf("watermark = %d, want %d", watermark(t, f, id), seq)
	}
}
