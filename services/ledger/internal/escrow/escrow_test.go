package escrow_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/escrow"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
	"github.com/yourtal/services/ledger/internal/testdb"
)

var counter atomic.Uint64

func unique(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), counter.Add(1))
}

type fixture struct {
	engine *escrow.Engine
	book   *ledger.Ledger
	pool   *pgxpool.Pool
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	book := ledger.New(pool)
	return &fixture{engine: escrow.New(pool, book), book: book, pool: pool}
}

// user makes a user in region holding `available` and `pending` points.
func (f *fixture) user(t *testing.T, region ledger.Region, available, pending int64) string {
	t.Helper()
	ctx := context.Background()
	id := unique("u")
	for _, a := range append(ledger.PlatformChart(region), ledger.UserAccounts(id, region)...) {
		if err := sqlcgen.New(f.pool).InsertAccount(ctx, sqlcgen.InsertAccountParams{ID: a.ID, OwnerType: string(a.OwnerType),
			OwnerID: a.OwnerID, Currency: string(a.Currency), Kind: string(a.Kind), Country: a.Country, Purpose: string(a.Purpose)}); err != nil {
			t.Fatal(err)
		}
	}
	postings := [][]ledger.Entry{ledger.GrantPartner(region, id, available+pending)}
	if available > 0 {
		postings = append(postings, ledger.Release(id, available))
	}
	for _, entries := range postings {
		if _, err := f.book.Transfer(ctx, ledger.TransferRequest{ID: unique("t"), IdempotencyKey: unique("k"),
			ReasonCode: "test", Entries: entries}); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

// balances is available, pending and escrow.
func (f *fixture) balances(t *testing.T, user string) [3]int64 {
	t.Helper()
	var out [3]int64
	for i, purpose := range []ledger.Purpose{ledger.PurposeAvailable, ledger.PurposePending, ledger.PurposeEscrow} {
		b, err := f.book.Balance(context.Background(), ledger.UserAccountID(user, purpose))
		if err != nil {
			t.Fatal(err)
		}
		out[i] = b
	}
	return out
}

// 9.4.b: escrow takes available first, then pending, and the release puts
// each part back where it came from, once.
func TestEscrowTakesAvailableThenPendingAndReleasesEachPartBack(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	user := f.user(t, ledger.RegionAU, 100, 50)

	held, err := f.engine.Hold(ctx, escrow.Request{UserID: user, Points: 120, Reason: "suspended", IdempotencyKey: unique("k")})
	if err != nil {
		t.Fatal(err)
	}
	if held.AvailablePoints != 100 || held.PendingPoints != 20 || held.Released || held.Region != ledger.RegionAU {
		t.Fatalf("held = %+v, want 100 from available and 20 from pending, in AU", held)
	}
	if got := f.balances(t, user); got != [3]int64{0, 30, 120} {
		t.Fatalf("while held: %v, want [0 30 120]", got)
	}

	for range 2 {
		released, err := f.engine.Release(ctx, held.ID)
		if err != nil {
			t.Fatal(err)
		}
		if !released.Released {
			t.Fatal("the escrow is not released")
		}
	}
	if got := f.balances(t, user); got != [3]int64{100, 50, 0} {
		t.Fatalf("after release: %v, want [100 50 0] exactly once", got)
	}
}

func TestEscrowNeverTakesMoreThanTheUserHolds(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	user := f.user(t, ledger.RegionID, 10, 5)

	_, err := f.engine.Hold(ctx, escrow.Request{UserID: user, Points: 16, Reason: "suspended"})
	if !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("err = %v, want ErrInsufficientFunds", err)
	}
	if got := f.balances(t, user); got != [3]int64{10, 5, 0} {
		t.Fatalf("a refused escrow moved points: %v", got)
	}
	if _, err := f.engine.Hold(ctx, escrow.Request{UserID: unique("nobody"), Points: 1, Reason: "suspended"}); !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("a user with no points: err = %v, want ErrInsufficientFunds", err)
	}
	if _, err := f.engine.Hold(ctx, escrow.Request{UserID: user, Points: 0, Reason: "suspended"}); !errors.Is(err, escrow.ErrInvalid) {
		t.Fatalf("zero points: err = %v, want ErrInvalid", err)
	}
	if _, err := f.engine.Release(ctx, unique("esc")); !errors.Is(err, escrow.ErrNotFound) {
		t.Fatalf("an unknown escrow: err = %v, want ErrNotFound", err)
	}
}

// A double submit escrows once; the same key with other terms is a conflict.
func TestEscrowIsIdempotent(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	user := f.user(t, ledger.RegionAU, 100, 0)
	req := escrow.Request{UserID: user, Points: 40, Reason: "dispute hold", IdempotencyKey: unique("k")}

	ids := make([]string, 8)
	var wg sync.WaitGroup
	for i := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			held, err := f.engine.Hold(ctx, req)
			if err != nil {
				t.Errorf("a resubmitted escrow failed: %v", err)
			}
			ids[i] = held.ID
		}()
	}
	wg.Wait()
	for _, id := range ids {
		if id != ids[0] {
			t.Fatalf("a double submit made two escrows: %v", ids)
		}
	}
	if got := f.balances(t, user); got != [3]int64{60, 0, 40} {
		t.Fatalf("balances = %v, want [60 0 40]", got)
	}
	req.Points = 41
	if _, err := f.engine.Hold(ctx, req); !errors.Is(err, ledger.ErrIdempotencyConflict) {
		t.Fatalf("err = %v, want ErrIdempotencyConflict", err)
	}
}

// Append-only: the ledger role cannot rewrite or delete an escrow.
func TestTheLedgerRoleCannotRewriteAnEscrow(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	user := f.user(t, ledger.RegionAU, 10, 0)
	held, err := f.engine.Hold(ctx, escrow.Request{UserID: user, Points: 10, Reason: "suspended"})
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`UPDATE ledger.escrow SET points = 1 WHERE id = $1`,
		`DELETE FROM ledger.escrow WHERE id = $1`,
	} {
		if _, err := f.pool.Exec(ctx, statement, held.ID); err == nil {
			t.Errorf("the ledger role ran %q", statement)
		}
	}
}
