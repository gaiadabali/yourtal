package ledger_test

import (
	"context"
	"errors"
	"math"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/ledgertest"
)

// 4.3: one regression test per audit defect (engine-money.md), each written
// to fail on the audit's scenario before its fix.

// fundedUser makes an AU user holding `available` spendable points.
func fundedUser(t *testing.T, book *ledger.Ledger, pool *pgxpool.Pool, available int64) string {
	t.Helper()
	user := unique("u")
	for _, a := range append(ledger.PlatformChart(au), ledger.UserAccounts(user, au)...) {
		insert(t, pool, a)
	}
	if available > 0 {
		ledgertest.PartnerGrant(t, pool, au, user, available)
		post(t, book, ledger.Release(user, available))
	}
	return user
}

func post(t *testing.T, book *ledger.Ledger, entries []ledger.Entry) {
	t.Helper()
	if _, err := transfer(book, entries); err != nil {
		t.Fatalf("post %+v: %v", entries, err)
	}
}

func transfer(book *ledger.Ledger, entries []ledger.Entry) (ledger.TransferResult, error) {
	return book.Transfer(context.Background(), ledger.TransferRequest{
		ID: unique("t"), IdempotencyKey: unique("k"), ReasonCode: "guard_test", Entries: entries,
	})
}

// EM-04: two burns of 400 against 500 both committed.
func TestConcurrentBurnsCannotOverdraw(t *testing.T) {
	book, pool := newLedger(t)
	user := fundedUser(t, book, pool, 500)

	var wg sync.WaitGroup
	var ok atomic.Int64
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := transfer(book, ledger.BurnPoints(au, user, 400)); err == nil {
				ok.Add(1)
			} else if !errors.Is(err, ledger.ErrInsufficientFunds) {
				t.Errorf("a refused burn failed with %v, want ErrInsufficientFunds", err)
			}
		}()
	}
	wg.Wait()

	if ok.Load() != 1 {
		t.Errorf("%d burns of 400 succeeded against 500, want exactly 1", ok.Load())
	}
	if b, _ := book.Balance(context.Background(), ledger.UserAccountID(user, ledger.PurposeAvailable)); b != 100 {
		t.Errorf("available = %d, want 100", b)
	}
}

// EM-04: every guarded account refuses a debit below zero; the rest may not
// be guarded (a contra account runs negative by design).
func TestGuardedAccountsCannotGoNegative(t *testing.T) {
	book, pool := newLedger(t)
	merchant := unique("m")
	insert(t, pool, ledger.MerchantPayable(merchant, au))
	user := fundedUser(t, book, pool, 50)
	// The seed funds marketing (4.4.l), so draw one more than whatever is there.
	marketingCash, err := book.Balance(context.Background(), ledger.PlatformAccountID(au, ledger.RoleMarketingCash))
	if err != nil {
		t.Fatal(err)
	}

	for name, entries := range map[string][]ledger.Entry{
		"user available":   ledger.BurnPoints(au, user, 51),
		"user pending":     ledger.Release(user, 1),
		"user escrow":      ledger.Reverse(ledger.Suspend(user, 1, 0)),
		"marketing cash":   ledger.MarketingBacking(au, marketingCash+1),
		"merchant payable": ledger.Payout(au, merchant, 1),
	} {
		if _, err := transfer(book, entries); !errors.Is(err, ledger.ErrInsufficientFunds) {
			t.Errorf("%s: err = %v, want ErrInsufficientFunds", name, err)
		}
	}
	if _, err := transfer(book, ledger.BurnPoints(au, user, 50)); err != nil {
		t.Errorf("spending exactly the balance was refused: %v", err)
	}
}

// EM-04, in the database: a ledger-role session that skips the Go check is
// still refused at COMMIT.
func TestTheDatabaseRefusesAnOverdraftTheServiceDidNotCheck(t *testing.T) {
	book, pool := newLedger(t)
	user := fundedUser(t, book, pool, 10)
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	id := unique("t")
	if _, err := tx.Exec(ctx, `INSERT INTO ledger.transfer (id, idempotency_key, reason_code) VALUES ($1, $1, 'raw')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency)
		VALUES ($1, $2, -11, 'YTP'), ($1, $3, 11, 'YTP')`,
		id, ledger.UserAccountID(user, ledger.PurposeAvailable), plat(au, ledger.RolePointsRedeemed)); err != nil {
		return // refused at insert: also fine
	}
	if err := tx.Commit(ctx); err == nil || !strings.Contains(err.Error(), "overdraft") {
		t.Fatalf("a raw overdraft committed: %v", err)
	}
}

// EM-09: a points entry landed on an AUD account and inflated the reserve.
func TestAnEntryMustBeInItsAccountsCurrency(t *testing.T) {
	book, pool := newLedger(t)
	for _, a := range ledger.PlatformChart(au) {
		insert(t, pool, a)
	}
	_, err := transfer(book, []ledger.Entry{
		{AccountID: plat(au, ledger.RolePlatformEquity), AmountMinor: -900, Currency: "YTP"},
		{AccountID: plat(au, ledger.RoleReserve), AmountMinor: 900, Currency: "YTP"},
	})
	if err == nil || !strings.Contains(err.Error(), "entry cannot post to AUD account") {
		t.Fatalf("YTP entries on AUD accounts: err = %v, want a currency refusal", err)
	}
}

// EM-14: key K used for 900 and reused for 5,000 returned success.
func TestSameKeyDifferentPayloadIsAConflict(t *testing.T) {
	book, pool := newLedger(t)
	from, to := makeAccounts(t, pool, "IDR")
	ctx := context.Background()
	key := unique("k")

	first, err := book.Transfer(ctx, ledger.TransferRequest{ID: unique("t"), IdempotencyKey: key, ReasonCode: "x",
		Entries: []ledger.Entry{{AccountID: from, AmountMinor: -900, Currency: "IDR"}, {AccountID: to, AmountMinor: 900, Currency: "IDR"}}})
	if err != nil {
		t.Fatal(err)
	}
	replay, err := book.Transfer(ctx, ledger.TransferRequest{ID: unique("t"), IdempotencyKey: key, ReasonCode: "x",
		Entries: []ledger.Entry{{AccountID: from, AmountMinor: -900, Currency: "IDR"}, {AccountID: to, AmountMinor: 900, Currency: "IDR"}}})
	if err != nil || !replay.Replayed || replay.TransferID != first.TransferID {
		t.Fatalf("an exact replay: %+v, %v; want the original transfer", replay, err)
	}
	_, err = book.Transfer(ctx, ledger.TransferRequest{ID: unique("t"), IdempotencyKey: key, ReasonCode: "x",
		Entries: []ledger.Entry{{AccountID: from, AmountMinor: -5_000, Currency: "IDR"}, {AccountID: to, AmountMinor: 5_000, Currency: "IDR"}}})
	if !errors.Is(err, ledger.ErrIdempotencyConflict) {
		t.Fatalf("same key, different amount: err = %v, want ErrIdempotencyConflict", err)
	}
}

// EM-18: the ledger role held INSERT with an explicit created_at.
func TestTheLedgerRoleCannotBackdate(t *testing.T) {
	_, pool := newLedger(t)
	from, to := makeAccounts(t, pool, "IDR")
	ctx := context.Background()
	id := unique("t")
	past := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `INSERT INTO ledger.transfer (id, idempotency_key, reason_code, created_at) VALUES ($1, $1, 'x', $2)`, id, past); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency, created_at)
		VALUES ($1, $2, -5, 'IDR', $4), ($1, $3, 5, 'IDR', $4)`, id, from, to, past); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	var transferAt, entryAt time.Time
	if err := pool.QueryRow(ctx, `SELECT t.created_at, min(e.created_at) FROM ledger.transfer t
		JOIN ledger.entry e ON e.transfer_id = t.id WHERE t.id = $1 GROUP BY t.created_at`, id).Scan(&transferAt, &entryAt); err != nil {
		t.Fatal(err)
	}
	if transferAt.Before(time.Now().Add(-time.Hour)) || entryAt.Before(time.Now().Add(-time.Hour)) {
		t.Errorf("backdated rows kept their dates: transfer %s, entry %s", transferAt, entryAt)
	}
}

// EM-18: balanced entries appended to a committed transfer in a later
// transaction were accepted, since the trigger only re-sums the set.
func TestACommittedTransferIsSealed(t *testing.T) {
	book, pool := newLedger(t)
	from, to := makeAccounts(t, pool, "IDR")
	original, err := book.Transfer(context.Background(), balancedRequest(from, to, 100))
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(context.Background(), `INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency)
		VALUES ($1, $2, -7, 'IDR'), ($1, $3, 7, 'IDR')`, original.TransferID, from, to)
	if err == nil || !strings.Contains(err.Error(), "sealed") {
		t.Fatalf("entries were appended to a committed transfer: %v", err)
	}
}

// EM-23: validate summed {MaxInt64, MaxInt64, 2} in int64, which wraps to 0.
func TestValidateCatchesAnOverflowingSum(t *testing.T) {
	book, pool := newLedger(t)
	a, b := makeAccounts(t, pool, "IDR")
	_, err := transfer(book, []ledger.Entry{
		{AccountID: a, AmountMinor: math.MaxInt64, Currency: "IDR"},
		{AccountID: b, AmountMinor: math.MaxInt64, Currency: "IDR"},
		{AccountID: a, AmountMinor: 2, Currency: "IDR"},
	})
	if !errors.Is(err, ledger.ErrUnbalanced) {
		t.Fatalf("err = %v, want ErrUnbalanced before anything is written", err)
	}
}
