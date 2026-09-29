package burn_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/burn"
	"github.com/yourtal/services/ledger/internal/expiry"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/ledgertest"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
	"github.com/yourtal/services/ledger/internal/testdb"
)

var counter atomic.Uint64

func unique(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), counter.Add(1))
}

type fixture struct {
	engine *burn.Engine
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
	return &fixture{engine: burn.New(pool, book), book: book, pool: pool}
}

// user makes a user in region holding `available` points.
func (f *fixture) user(t *testing.T, region ledger.Region, available int64) string {
	t.Helper()
	ctx := context.Background()
	id := unique("u")
	for _, a := range append(ledger.PlatformChart(region), ledger.UserAccounts(id, region)...) {
		if err := sqlcgen.New(f.pool).InsertAccount(ctx, sqlcgen.InsertAccountParams{ID: a.ID, OwnerType: string(a.OwnerType),
			OwnerID: a.OwnerID, Currency: string(a.Currency), Kind: string(a.Kind), Country: a.Country, Purpose: string(a.Purpose)}); err != nil {
			t.Fatal(err)
		}
	}
	if available == 0 {
		return id
	}
	ledgertest.PartnerGrant(t, f.pool, region, id, available)
	if _, err := f.book.Transfer(ctx, ledger.TransferRequest{ID: unique("t"), IdempotencyKey: unique("k"),
		ReasonCode: "test", Entries: ledger.Release(id, available)}); err != nil {
		t.Fatal(err)
	}
	return id
}

func (f *fixture) available(t *testing.T, user string) int64 {
	t.Helper()
	b, err := f.book.Balance(context.Background(), ledger.UserAccountID(user, ledger.PurposeAvailable))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// 4.7.d's "a double submit burns once", at the ledger: eight concurrent
// burns of one saga move the points once.
func TestADoubleSubmitBurnsOnce(t *testing.T) {
	f := newFixture(t)
	user := f.user(t, ledger.RegionAU, 1_000)
	req := burn.Request{SagaID: unique("saga"), UserID: user, Region: ledger.RegionAU, Points: 400, SettlementMinor: 1_200}

	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := f.engine.Burn(context.Background(), req); err != nil {
				t.Errorf("a resubmitted burn failed: %v", err)
			}
		}()
	}
	wg.Wait()
	if got := f.available(t, user); got != 600 {
		t.Errorf("available = %d after one 400-point burn, want 600", got)
	}
	other := req
	other.Points = 500
	if _, err := f.engine.Burn(context.Background(), other); !errors.Is(err, ledger.ErrIdempotencyConflict) {
		t.Errorf("the same saga for 500: err = %v, want ErrIdempotencyConflict", err)
	}
}

func TestABurnBeyondTheBalanceIsRefused(t *testing.T) {
	f := newFixture(t)
	user := f.user(t, ledger.RegionAU, 300)
	_, err := f.engine.Burn(context.Background(), burn.Request{SagaID: unique("saga"), UserID: user,
		Region: ledger.RegionAU, Points: 301, SettlementMinor: 900})
	if !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("burning 301 of 300: err = %v", err)
	}
}

// 4.7.d: an ID user's burn of an AU listing is refused even when the
// ledger is called directly.
func TestTheLedgerRefusesACrossRegionBurn(t *testing.T) {
	f := newFixture(t)
	user := f.user(t, ledger.RegionID, 10_000)
	_, err := f.engine.Burn(context.Background(), burn.Request{SagaID: unique("saga"), UserID: user,
		Region: ledger.RegionAU, Points: 1_000, SettlementMinor: 3_000})
	if !errors.Is(err, burn.ErrRegionMismatch) {
		t.Fatalf("an ID user burned in AU: err = %v", err)
	}
	if got := f.available(t, user); got != 10_000 {
		t.Errorf("available = %d, want 10000", got)
	}
}

// K13: an uncaptured voucher the merchant would not honour gives the exact
// points back at once, and the voucher is no longer owed. Once.
func TestReinstatingABurnReturnsTheExactPointsOnce(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	user := f.user(t, ledger.RegionAU, 1_000)
	liability := ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleVoucherLiability)
	owedBefore, _ := f.book.Balance(ctx, liability)
	saga := unique("saga")
	if _, err := f.engine.Burn(ctx, burn.Request{SagaID: saga, UserID: user, Region: ledger.RegionAU,
		Points: 400, SettlementMinor: 1_200}); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		got, err := f.engine.Reinstate(ctx, saga, "merchant refused the voucher")
		if err != nil || !got.Reinstated {
			t.Fatalf("reinstate: %+v, %v", got, err)
		}
	}
	if got := f.available(t, user); got != 1_000 {
		t.Errorf("available = %d after reinstatement, want 1000", got)
	}
	if owed, _ := f.book.Balance(ctx, liability); owed != owedBefore {
		t.Errorf("voucher liability %d -> %d; the reinstated voucher is still owed", owedBefore, owed)
	}
}

func TestGetBurnFindsOnlyWhatWasBurned(t *testing.T) {
	f := newFixture(t)
	if _, err := f.engine.Get(context.Background(), unique("saga")); !errors.Is(err, burn.ErrNotFound) {
		t.Fatalf("a saga that never burned: err = %v", err)
	}
}

func lastActivity(t *testing.T, pool *pgxpool.Pool, accountID string) time.Time {
	t.Helper()
	var at time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT last_activity_at FROM ledger.account WHERE id = $1`, accountID).Scan(&at); err != nil {
		t.Fatalf("reading last_activity_at: %v", err)
	}
	return at
}

// setPointsExpiry proposes+approves a points_expiry setting for region, the
// same two-person shape expiry_test.go's own helper uses (duplicated here,
// not exported cross-package, so this test stays self-contained).
func setPointsExpiry(t *testing.T, region, value string) {
	t.Helper()
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatalf("connect as owner: %v", err)
	}
	defer owner.Close()
	var id string
	if err := owner.QueryRow(ctx,
		`INSERT INTO platform.region_setting (region, key, value, set_by)
		   VALUES ($1, 'points_expiry', $2::jsonb, $3) RETURNING id`,
		region, value, unique("proposer")).Scan(&id); err != nil {
		t.Fatalf("proposing points_expiry: %v", err)
	}
	if _, err := owner.Exec(ctx,
		`UPDATE platform.region_setting SET approved_by = $2 WHERE id = $1`, id, unique("approver")); err != nil {
		t.Fatalf("approving points_expiry: %v", err)
	}
}

// 10.2.e (gap in 10.2.a): only grants touched last_activity_at, so a user
// who only ever spends could drift into "inactive" while genuinely in use.
// A burn now touches it too, in the same transaction as the rest of the burn.
func TestBurnTouchesLastActivity(t *testing.T) {
	f := newFixture(t)
	user := f.user(t, ledger.RegionAU, 1_000)
	accountID := ledger.UserAccountID(user, ledger.PurposeAvailable)

	// Push the clock back as if the account had gone quiet since it was funded.
	old := time.Now().AddDate(0, -13, 0)
	if _, err := f.pool.Exec(context.Background(),
		`UPDATE ledger.account SET last_activity_at = $2 WHERE id = $1`, accountID, old); err != nil {
		t.Fatalf("clock-shifting activity: %v", err)
	}

	req := burn.Request{SagaID: unique("saga"), UserID: user, Region: ledger.RegionAU, Points: 200, SettlementMinor: 600}
	if _, err := f.engine.Burn(context.Background(), req); err != nil {
		t.Fatalf("burn: %v", err)
	}

	after := lastActivity(t, f.pool, accountID)
	if !after.After(old.Add(time.Hour)) {
		t.Errorf("last_activity_at after the burn = %s, want it moved to (near) now, not left at %s", after, old)
	}
}

// 10.2.e's own Check: with expiry on, an account that only burns (never
// granted anything fresh since) is not swept as inactive, because the burn
// itself re-touches the clock.
func TestAnAccountThatOnlyBurnsIsNotExpiredWhileActive(t *testing.T) {
	f := newFixture(t)
	setPointsExpiry(t, "AU", `{"enabled": true, "inactivityMonths": 12}`)
	user := f.user(t, ledger.RegionAU, 1_000)
	accountID := ledger.UserAccountID(user, ledger.PurposeAvailable)

	// Dormant past the 12-month cutoff -- until the burn below re-touches it.
	if _, err := f.pool.Exec(context.Background(),
		`UPDATE ledger.account SET last_activity_at = now() - interval '13 months' WHERE id = $1`, accountID); err != nil {
		t.Fatalf("clock-shifting activity: %v", err)
	}

	req := burn.Request{SagaID: unique("saga"), UserID: user, Region: ledger.RegionAU, Points: 200, SettlementMinor: 600}
	if _, err := f.engine.Burn(context.Background(), req); err != nil {
		t.Fatalf("burn: %v", err)
	}

	if _, err := expiry.Run(context.Background(), f.pool, f.book, ledger.RegionAU, 1000); err != nil {
		t.Fatalf("expiry run: %v", err)
	}

	if remaining := f.available(t, user); remaining != 800 {
		t.Errorf("available = %d, want 800 (the 1,000 minus the 200 burn, untouched by expiry)", remaining)
	}
}
