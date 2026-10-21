package reward_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/ledgertest"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// Group 2.10.b (docs/27 §3.6): ledger.receipt_package, its K6 trigger, its
// grants, and the order a receipt draws packages in. The purchases here are
// written straight to the tables, at any price, so what refuses an
// underpaid package is the database and not the Go pricing.

type boughtPoints struct{ allocation, purchase, funder string }

// receiptPool is the ledger role's pool with both regions' charts and the
// F1 rates in force.
func receiptPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	_, pool := newEngine(t, reward.AlwaysAllow{})
	if err := reward.New(pool, ledger.New(pool), reward.AlwaysAllow{}, ledger.RegionAU).EnsureChart(context.Background()); err != nil {
		t.Fatal(err)
	}
	return pool
}

// rawPurchase writes what RecordPurchase writes (a partner allocation, its
// cash into the reserve and the purchase row) without its price check.
func rawPurchase(t *testing.T, pool *pgxpool.Pool, region ledger.Region, funder string, allocationPoints, purchasePoints, amount int64) boughtPoints {
	t.Helper()
	ctx := context.Background()
	bought := boughtPoints{allocation: unique("alloc_rcpt"), purchase: unique("pur_rcpt"), funder: funder}
	r := string(region)
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		if err := q.InsertAllocation(ctx, sqlcgen.InsertAllocationParams{ID: bought.allocation, FunderType: "partner",
			FunderID: funder, TotalPoints: allocationPoints, Region: &r}); err != nil {
			return err
		}
		cash, err := ledger.New(pool).TransferInTx(ctx, tx, ledger.TransferRequest{
			ID: unique("t_rcpt"), IdempotencyKey: unique("k_rcpt"), ReasonCode: "partner_point_purchase",
			Entries: ledger.Purchase(region, amount),
		})
		if err != nil {
			return err
		}
		return q.InsertPointPurchase(ctx, sqlcgen.InsertPointPurchaseParams{ID: bought.purchase, PartnerID: funder,
			Points: purchasePoints, AmountMinor: amount, Currency: string(region.Currency()),
			AllocationID: bought.allocation, CashTransferID: cash.TransferID})
	})
	if err != nil {
		t.Fatalf("writing a purchase: %v", err)
	}
	return bought
}

func rateInForce(t *testing.T, pool *pgxpool.Pool, region ledger.Region) sqlcgen.GetBackingRateInForceRow {
	t.Helper()
	rate, err := sqlcgen.New(pool).GetBackingRateInForce(context.Background(), string(region.Currency()))
	if err != nil {
		t.Fatalf("rate in force: %v", err)
	}
	return rate
}

// atB is the least a purchase of points may pay: ceil(points × B).
func atB(t *testing.T, pool *pgxpool.Pool, region ledger.Region, points int64) int64 {
	micros := points * rateInForce(t, pool, region).MicrosPerPoint
	return (micros + 999_999) / 1_000_000
}

// insertPackage inserts the row and commits, returning each step's error:
// the trigger is deferred, so a bad package is taken by INSERT and refused
// by COMMIT.
func insertPackage(pool *pgxpool.Pool, p sqlcgen.InsertReceiptPackageParams) (insertErr, commitErr error) {
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err, nil
	}
	if err := sqlcgen.New(tx).InsertReceiptPackage(ctx, p); err != nil {
		_ = tx.Rollback(ctx)
		return err, nil
	}
	return nil, tx.Commit(ctx)
}

func packageOf(b boughtPoints, region ledger.Region, rateID string) sqlcgen.InsertReceiptPackageParams {
	return sqlcgen.InsertReceiptPackageParams{AllocationID: b.allocation, PurchaseID: b.purchase,
		FunderID: b.funder, Region: string(region), RateID: rateID}
}

func sqlState(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func wantRefusedAtCommit(t *testing.T, what string, insertErr, commitErr error) {
	t.Helper()
	if insertErr != nil {
		t.Fatalf("%s: the INSERT itself failed (%v); the check belongs at COMMIT", what, insertErr)
	}
	if sqlState(commitErr) != "23514" {
		t.Fatalf("%s: commit err = %v, want a check_violation", what, commitErr)
	}
}

// goodPackage is a package bought at exactly B in force, committed.
func goodPackage(t *testing.T, pool *pgxpool.Pool, region ledger.Region, funder string) boughtPoints {
	t.Helper()
	b := rawPurchase(t, pool, region, funder, 1_000, 1_000, atB(t, pool, region, 1_000))
	if insertErr, commitErr := insertPackage(pool, packageOf(b, region, rateInForce(t, pool, region).ID)); insertErr != nil || commitErr != nil {
		t.Fatalf("a package at B: insert %v, commit %v", insertErr, commitErr)
	}
	return b
}

func TestAReceiptPackageIsPaidAtLeastB(t *testing.T) {
	pool := receiptPool(t)
	ctx := context.Background()
	rate := rateInForce(t, pool, ledger.RegionAU).ID
	floor := atB(t, pool, ledger.RegionAU, 1_000) // A$30.00 at B = 3¢

	short := rawPurchase(t, pool, ledger.RegionAU, unique("biz"), 1_000, 1_000, floor-1)
	insertErr, commitErr := insertPackage(pool, packageOf(short, ledger.RegionAU, rate))
	wantRefusedAtCommit(t, "a cent under points × B", insertErr, commitErr)
	if is, _ := sqlcgen.New(pool).IsReceiptPackage(ctx, short.allocation); is {
		t.Error("the refused package was kept")
	}

	exact := rawPurchase(t, pool, ledger.RegionAU, unique("biz"), 1_000, 1_000, floor)
	if insertErr, commitErr := insertPackage(pool, packageOf(exact, ledger.RegionAU, rate)); insertErr != nil || commitErr != nil {
		t.Fatalf("exactly points × B: insert %v, commit %v", insertErr, commitErr)
	}
	q := sqlcgen.New(pool)
	if is, err := q.IsReceiptPackage(ctx, exact.allocation); err != nil || !is {
		t.Errorf("IsReceiptPackage = %v, %v; want true", is, err)
	}
	if row, err := q.GetAllocationWithRegion(ctx, exact.allocation); err != nil || !row.IsReceiptPackage {
		t.Errorf("GetAllocationWithRegion.IsReceiptPackage = %v, %v; want true", row.IsReceiptPackage, err)
	}
	plain := rawPurchase(t, pool, ledger.RegionAU, exact.funder, 1_000, 1_000, floor*2)
	rows, err := q.ListAllocationsForFunder(ctx, exact.funder)
	if err != nil || len(rows) != 2 {
		t.Fatalf("ListAllocationsForFunder = %d rows, %v; want 2", len(rows), err)
	}
	for _, row := range rows {
		if want := row.ID == exact.allocation; row.IsReceiptPackage != want {
			t.Errorf("allocation %s: IsReceiptPackage = %v, want %v (plain is %s)", row.ID, row.IsReceiptPackage, want, plain.allocation)
		}
	}
}

func TestAReceiptPackageMatchesItsAllocationPurchaseAndRate(t *testing.T) {
	pool := receiptPool(t)
	au := ledger.RegionAU
	auRate := rateInForce(t, pool, au).ID
	floor := atB(t, pool, au, 1_000)
	fresh := func() boughtPoints { return rawPurchase(t, pool, au, unique("biz"), 1_000, 1_000, floor) }

	t.Run("another funder", func(t *testing.T) {
		p := packageOf(fresh(), au, auRate)
		p.FunderID = unique("biz")
		insertErr, commitErr := insertPackage(pool, p)
		wantRefusedAtCommit(t, "funder", insertErr, commitErr)
	})
	t.Run("another region", func(t *testing.T) {
		insertErr, commitErr := insertPackage(pool, packageOf(fresh(), ledger.RegionID, rateInForce(t, pool, ledger.RegionID).ID))
		wantRefusedAtCommit(t, "region", insertErr, commitErr)
	})
	t.Run("another purchase's allocation", func(t *testing.T) {
		a, b := fresh(), fresh()
		p := packageOf(a, au, auRate)
		p.PurchaseID = b.purchase
		p.FunderID = a.funder
		insertErr, commitErr := insertPackage(pool, p)
		wantRefusedAtCommit(t, "allocation", insertErr, commitErr)
	})
	t.Run("points the purchase did not buy", func(t *testing.T) {
		// 2,000 points allocated, 1,000 bought, paid for 2,000.
		b := rawPurchase(t, pool, au, unique("biz"), 2_000, 1_000, atB(t, pool, au, 2_000))
		insertErr, commitErr := insertPackage(pool, packageOf(b, au, auRate))
		wantRefusedAtCommit(t, "points", insertErr, commitErr)
	})
	t.Run("the other currency's rate", func(t *testing.T) {
		insertErr, commitErr := insertPackage(pool, packageOf(fresh(), au, rateInForce(t, pool, ledger.RegionID).ID))
		wantRefusedAtCommit(t, "rate currency", insertErr, commitErr)
	})
	t.Run("a rate no longer in force", func(t *testing.T) {
		// F1's seeded AUD rate: newEngine has since approved a newer one.
		insertErr, commitErr := insertPackage(pool, packageOf(fresh(), au, "rate_f1_aud"))
		wantRefusedAtCommit(t, "stale rate", insertErr, commitErr)
	})
	t.Run("a marketing allocation", func(t *testing.T) {
		ctx := context.Background()
		b := fresh()
		marketing := unique("alloc_mkt")
		r := string(au)
		if err := sqlcgen.New(pool).InsertAllocation(ctx, sqlcgen.InsertAllocationParams{ID: marketing,
			FunderType: "marketing", FunderID: b.funder, TotalPoints: 1_000, Region: &r}); err != nil {
			t.Fatal(err)
		}
		p := packageOf(b, au, auRate)
		p.AllocationID = marketing
		insertErr, commitErr := insertPackage(pool, p)
		wantRefusedAtCommit(t, "marketing allocation", insertErr, commitErr)
	})
}

func TestTheLedgerCannotChangeOrRemoveAReceiptPackage(t *testing.T) {
	pool := receiptPool(t)
	ctx := context.Background()
	b := goodPackage(t, pool, ledger.RegionAU, unique("biz"))

	if _, err := pool.Exec(ctx, `UPDATE ledger.receipt_package SET funder_id = 'someone_else' WHERE allocation_id = $1`, b.allocation); sqlState(err) != "42501" {
		t.Errorf("UPDATE as yourtal_ledger: err = %v, want insufficient_privilege", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM ledger.receipt_package WHERE allocation_id = $1`, b.allocation); sqlState(err) != "42501" {
		t.Errorf("DELETE as yourtal_ledger: err = %v, want insufficient_privilege", err)
	}
	if is, err := sqlcgen.New(pool).IsReceiptPackage(ctx, b.allocation); err != nil || !is {
		t.Errorf("the package after both attempts: %v, %v", is, err)
	}
}

func TestTheAppCannotReadReceiptPackages(t *testing.T) {
	receiptPool(t) // the same skip as the other suites when Postgres is down
	ctx := context.Background()
	app, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect as yourtal_app: %v", err)
	}
	defer app.Close()
	var user string
	if err := app.QueryRow(ctx, `SELECT current_user`).Scan(&user); err != nil || user != "yourtal_app" {
		t.Fatalf("DATABASE_URL connects as %q (%v), want yourtal_app", user, err)
	}
	if _, err := app.Exec(ctx, `SELECT count(*) FROM ledger.receipt_package`); sqlState(err) != "42501" {
		t.Errorf("SELECT as yourtal_app: err = %v, want insufficient_privilege", err)
	}
}

func TestReceiptPackagesWithRoomAreOldestFirst(t *testing.T) {
	pool := receiptPool(t)
	ctx := context.Background()
	funder := unique("biz")
	first := goodPackage(t, pool, ledger.RegionAU, funder)
	second := goodPackage(t, pool, ledger.RegionAU, funder)
	third := goodPackage(t, pool, ledger.RegionAU, funder)
	goodPackage(t, pool, ledger.RegionAU, unique("biz"))                                              // another funder's
	rawPurchase(t, pool, ledger.RegionAU, funder, 1_000, 1_000, atB(t, pool, ledger.RegionAU, 1_000)) // not a package

	// The second package keeps 1 point of room.
	q := sqlcgen.New(pool)
	if held, err := q.HoldAllocation(ctx, sqlcgen.HoldAllocationParams{HoldID: unique("hold"),
		AllocationID: second.allocation, Points: 999, TtlSeconds: 3600}); err != nil || !held {
		t.Fatalf("holding 999 of the second package: %v, %v", held, err)
	}

	ids := func(points int64) []string {
		rows, err := q.ReceiptPackagesWithRoom(ctx, sqlcgen.ReceiptPackagesWithRoomParams{
			FunderID: funder, Region: "AU", Points: points})
		if err != nil {
			t.Fatalf("ReceiptPackagesWithRoom(%d): %v", points, err)
		}
		out := make([]string, 0, len(rows))
		for _, row := range rows {
			out = append(out, row.AllocationID)
		}
		return out
	}
	same := func(got, want []string) bool {
		if len(got) != len(want) {
			return false
		}
		for i := range got {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}
	if got, want := ids(1), []string{first.allocation, second.allocation, third.allocation}; !same(got, want) {
		t.Errorf("room for 1 point: %v, want oldest first %v", got, want)
	}
	if got, want := ids(2), []string{first.allocation, third.allocation}; !same(got, want) {
		t.Errorf("room for 2 points: %v, want %v (the second has 1 left)", got, want)
	}
	rows, err := q.ReceiptPackagesWithRoom(ctx, sqlcgen.ReceiptPackagesWithRoomParams{FunderID: funder, Region: "ID", Points: 1})
	if err != nil || len(rows) != 0 {
		t.Errorf("the funder's ID packages: %d rows, %v; want none", len(rows), err)
	}
}

// The ledger's settings view keeps its 13 keys and adds each approved
// receipt_funder.<partner> row, and nothing that only looks like one.
func TestTheLedgerSettingViewReadsReceiptFunders(t *testing.T) {
	pool := receiptPool(t)
	ctx := context.Background()
	partner := unique("partner")
	ledgertest.SetRegionSetting(t, "AU", "receipt_funder."+partner, `{"businessId": "00000000-0000-0000-0000-000000000001"}`)
	ledgertest.SetRegionSetting(t, "AU", "receipt_funderX"+partner, `{}`)

	want := []string{"daily_earn_cap", "goodwill_case_limit_points", "holdback_hours_by_tier", "marketing_budget",
		"monthly_earn_cap", "point_package_tiers", "points_expiry", "points_pack", "receipt_points",
		"settlement_dispute_window_days", "streak_bonus_points", "streak_coverage_pause_threshold", "teen_daily_earn_cap"}
	for _, region := range []string{"AU", "ID"} {
		rows, err := pool.Query(ctx, `SELECT key FROM platform.ledger_setting
			WHERE region = $1 AND NOT starts_with(key, 'receipt_funder.') ORDER BY key`, region)
		if err != nil {
			t.Fatal(err)
		}
		keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		if strings.Join(keys, ",") != strings.Join(want, ",") {
			t.Errorf("%s keys = %v, want %v", region, keys, want)
		}
	}
	var funders []string
	rows, err := pool.Query(ctx, `SELECT key FROM platform.ledger_setting WHERE region = 'AU' AND key LIKE '%' || $1`, partner)
	if err == nil {
		funders, err = pgx.CollectRows(rows, pgx.RowTo[string])
	}
	if err != nil || len(funders) != 1 || funders[0] != "receipt_funder."+partner {
		t.Errorf("AU rows for %s = %v, %v; want only receipt_funder.%s", partner, funders, err, partner)
	}
}
