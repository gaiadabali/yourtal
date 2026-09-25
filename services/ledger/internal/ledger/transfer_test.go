package ledger_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// YT-0042, against the real Postgres from `pnpm dev:up`.
//
// A mocked pool would prove nothing here. Every claim in this file is about
// what Postgres does — the deferred balance trigger, the UNIQUE idempotency
// key, Serializable isolation under concurrency — and none of those exist in
// a fake.

func newLedger(t *testing.T) (*ledger.Ledger, *pgxpool.Pool) {
	t.Helper()

	url := testdb.URL(t, "LEDGER_DATABASE_URL")

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("no local Postgres (run `pnpm dev:up`): %v", err)
	}
	t.Cleanup(pool.Close)

	return ledger.New(pool), pool
}

// unique keeps parallel runs and repeated runs from colliding, so a failure
// is reproducible rather than a leftover from last time.
//
// The counter is not belt-and-braces. A timestamp alone is NOT unique under
// concurrency: Windows' clock granularity is coarse enough that sixteen
// goroutines calling UnixNano() in a tight loop get the same value, which
// made the concurrency test below generate one idempotency key sixteen times
// — and the ledger then correctly deduplicated all sixteen into one
// transfer. The test failed; the ledger was right. Worth keeping the story,
// because "the timestamp is unique enough" is a seductive and wrong belief.
var uniqueCounter atomic.Uint64

func unique(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), uniqueCounter.Add(1))
}

func makeAccounts(t *testing.T, pool *pgxpool.Pool, currency string) (string, string) {
	t.Helper()
	ctx := context.Background()
	queries := sqlcgen.New(pool)

	from, to := unique("acc_from"), unique("acc_to")
	for _, id := range []string{from, to} {
		if err := queries.InsertAccount(ctx, sqlcgen.InsertAccountParams{
			ID: id, OwnerType: "platform", OwnerID: id, Currency: currency,
			// YT-0043: every account carries a classification. Equity is the
			// neutral choice for a test account with no external claim on it.
			Kind: "equity", Country: "ID",
		}); err != nil {
			t.Fatalf("seed account: %v", err)
		}
	}
	return from, to
}

func balancedRequest(from, to string, amount int64) ledger.TransferRequest {
	return ledger.TransferRequest{
		ID:             unique("led_txn"),
		IdempotencyKey: unique("idem"),
		ReasonCode:     "test",
		Entries: []ledger.Entry{
			{AccountID: from, AmountMinor: -amount, Currency: "IDR"},
			{AccountID: to, AmountMinor: amount, Currency: "IDR"},
		},
	}
}

func TestTransferWritesBalancedEntries(t *testing.T) {
	svc, pool := newLedger(t)
	from, to := makeAccounts(t, pool, "IDR")
	ctx := context.Background()

	result, err := svc.Transfer(ctx, balancedRequest(from, to, 1_500))
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
	if result.Replayed {
		t.Error("a first transfer should not report as replayed")
	}

	fromBalance, err := svc.Balance(ctx, from)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	toBalance, err := svc.Balance(ctx, to)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}

	if fromBalance != -1_500 || toBalance != 1_500 {
		t.Errorf("balances = %d / %d, want -1500 / 1500", fromBalance, toBalance)
	}
}

// AC: "Replay of an idempotency key returns the original transfer, never a
// second one." The whole retry story rests on this.
func TestReplayReturnsTheOriginalTransfer(t *testing.T) {
	svc, pool := newLedger(t)
	from, to := makeAccounts(t, pool, "IDR")
	ctx := context.Background()

	req := balancedRequest(from, to, 900)
	first, err := svc.Transfer(ctx, req)
	if err != nil {
		t.Fatalf("first: %v", err)
	}

	// A different transfer id, the same key — a retry that regenerated its
	// own id, which is exactly what a retrying client does.
	replayReq := req
	replayReq.ID = unique("led_txn_retry")

	second, err := svc.Transfer(ctx, replayReq)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}

	if !second.Replayed {
		t.Error("a replay should say so")
	}
	if second.TransferID != first.TransferID {
		t.Errorf("replay returned %s, want the original %s", second.TransferID, first.TransferID)
	}

	// The money must not have moved twice.
	balance, err := svc.Balance(ctx, to)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 900 {
		t.Errorf("balance = %d after a replay, want 900 — the replay moved value again", balance)
	}
}

// AC: "Concurrent transfers on one account are serialised and correct under
// load test." Serializable plus a retry on 40001 is what makes this true;
// at a weaker level these can interleave into a total neither would produce.
func TestConcurrentTransfersOnOneAccountAreCorrect(t *testing.T) {
	svc, pool := newLedger(t)
	from, to := makeAccounts(t, pool, "IDR")
	ctx := context.Background()

	const writers = 16
	const amount = 100

	var wg sync.WaitGroup
	errs := make(chan error, writers)

	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.Transfer(ctx, balancedRequest(from, to, amount)); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		t.Errorf("concurrent transfer failed: %v", err)
	}

	balance, err := svc.Balance(ctx, to)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if want := int64(writers * amount); balance != want {
		t.Errorf("balance = %d, want %d — concurrent writes lost or double-counted", balance, want)
	}
}

// Concurrent RETRIES of one key, which is the realistic shape: a client
// times out and its retry races the original.
func TestConcurrentReplaysOfOneKeyMoveValueOnce(t *testing.T) {
	svc, pool := newLedger(t)
	from, to := makeAccounts(t, pool, "IDR")
	ctx := context.Background()

	req := balancedRequest(from, to, 250)

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			attempt := req
			attempt.ID = fmt.Sprintf("%s_%d", req.ID, n)
			_, _ = svc.Transfer(ctx, attempt)
		}(i)
	}
	wg.Wait()

	balance, err := svc.Balance(ctx, to)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 250 {
		t.Errorf("balance = %d, want 250 — one key moved value more than once", balance)
	}
}

func TestRejectsMalformedTransfers(t *testing.T) {
	svc, pool := newLedger(t)
	from, to := makeAccounts(t, pool, "IDR")
	ctx := context.Background()

	cases := []struct {
		name    string
		entries []ledger.Entry
		want    error
	}{
		{
			name:    "unbalanced",
			entries: []ledger.Entry{{from, -100, "IDR"}, {to, 99, "IDR"}},
			want:    ledger.ErrUnbalanced,
		},
		{
			name:    "single entry",
			entries: []ledger.Entry{{from, -100, "IDR"}},
			want:    ledger.ErrTooFewEntries,
		},
		{
			name:    "zero amount",
			entries: []ledger.Entry{{from, 0, "IDR"}, {to, 0, "IDR"}},
			want:    ledger.ErrZeroAmount,
		},
		{
			// A transfer that mixes currencies is not a transfer; it is an
			// unrecorded FX trade, and it would "balance" numerically while
			// being nonsense.
			name:    "mixed currency",
			entries: []ledger.Entry{{from, -100, "IDR"}, {to, 100, "AUD"}},
			want:    ledger.ErrMixedCurrency,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := ledger.TransferRequest{
				ID:             unique("led_txn_bad"),
				IdempotencyKey: unique("idem_bad"),
				ReasonCode:     "test",
				Entries:        tc.entries,
			}
			_, err := svc.Transfer(ctx, req)
			if !errors.Is(err, tc.want) {
				t.Errorf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

// Should always pass. It is worth running because the day it does not, the
// trigger has been dropped or bypassed and nothing else would say so.
func TestInvariantCheckerFindsNoImbalance(t *testing.T) {
	svc, _ := newLedger(t)

	imbalances, err := svc.CheckInvariants(context.Background())
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(imbalances) != 0 {
		t.Errorf("found %d imbalanced transfers: %v", len(imbalances), imbalances)
	}
}
