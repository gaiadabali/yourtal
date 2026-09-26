package ledger_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// 4.10: AU and ID never cross, in the database as well as in Go (F2). Each
// case writes the crossing row directly, as the owner, skipping every Go
// check, and must be refused by a constraint or trigger.

func ownerPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// rawTx runs stmts in one transaction and returns the first error, COMMIT's
// included (the region triggers are checked at commit).
func rawTx(t *testing.T, pool *pgxpool.Pool, stmts ...func(ctx context.Context, exec func(string, ...any) error) error) error {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	exec := func(sql string, args ...any) error { _, err := tx.Exec(ctx, sql, args...); return err }
	for _, stmt := range stmts {
		if err := stmt(ctx, exec); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func sql(query string, args ...any) func(context.Context, func(string, ...any) error) error {
	return func(_ context.Context, exec func(string, ...any) error) error { return exec(query, args...) }
}

func marketingAllocation(t *testing.T, owner *pgxpool.Pool, region ledger.Region) string {
	t.Helper()
	allocation := unique("alloc")
	if _, err := owner.Exec(context.Background(), `INSERT INTO ledger.allocation
		(id, funder_type, funder_id, currency, total_points, remaining_points, region)
		VALUES ($1, 'marketing', 'platform', 'YTP', 100, 100, $2)`, allocation, string(region)); err != nil {
		t.Fatal(err)
	}
	return allocation
}

func grantRow(transferID, allocation string, region ledger.Region) func(context.Context, func(string, ...any) error) error {
	return sql(`INSERT INTO ledger.grant (id, user_id, action_type, taxonomy_ver, points, allocation_id,
		transfer_id, external_ref, region) VALUES ($1, 'u-wall', 'daily_streak', 1, 10, $2, $3, $1, $4)`,
		unique("g"), allocation, transferID, string(region))
}

func TestAGrantCannotCrossRegions(t *testing.T) {
	book, pool := newLedger(t)
	owner := ownerPool(t)
	user := unique("u")
	for _, a := range append(append(ledger.PlatformChart(au), ledger.PlatformChart(id)...), ledger.UserAccounts(user, au)...) {
		insert(t, pool, a)
	}
	auGrant, err := transfer(book, ledger.GrantPartner(au, user, 10))
	if err != nil {
		t.Fatal(err)
	}

	// An ID allocation paying an AU user.
	if err := rawTx(t, owner, grantRow(auGrant.TransferID, marketingAllocation(t, owner, id), au)); err == nil ||
		!strings.Contains(err.Error(), "crosses regions") {
		t.Fatalf("an ID allocation funded an AU grant: %v", err)
	}
	// An AU transfer recorded as an ID grant.
	if err := rawTx(t, owner, grantRow(auGrant.TransferID, marketingAllocation(t, owner, au), id)); err == nil ||
		!strings.Contains(err.Error(), "crosses regions") {
		t.Fatalf("an AU transfer was recorded as an ID grant: %v", err)
	}
	if err := rawTx(t, owner, grantRow(auGrant.TransferID, marketingAllocation(t, owner, au), au)); err != nil {
		t.Fatalf("an all-AU grant was refused: %v", err)
	}
}

func TestAPurchaseCannotCrossRegions(t *testing.T) {
	book, pool := newLedger(t)
	owner := ownerPool(t)
	for _, a := range append(ledger.PlatformChart(au), ledger.PlatformChart(id)...) {
		insert(t, pool, a)
	}
	auCash, err := transfer(book, ledger.Purchase(au, 1_000))
	if err != nil {
		t.Fatal(err)
	}
	purchase := func(currency string, allocation string) func(context.Context, func(string, ...any) error) error {
		return sql(`INSERT INTO ledger.point_purchase (id, partner_id, points, amount_minor, currency, allocation_id,
			cash_transfer_id) VALUES ($1, 'p-wall', 100, 1000, $2, $3, $4)`, unique("pp"), currency, allocation, auCash.TransferID)
	}
	if err := rawTx(t, owner, purchase("AUD", marketingAllocation(t, owner, id))); err == nil ||
		!strings.Contains(err.Error(), "crosses regions") {
		t.Fatalf("AU cash funded an ID allocation: %v", err)
	}
	if err := rawTx(t, owner, purchase("IDR", marketingAllocation(t, owner, au))); err == nil ||
		!strings.Contains(err.Error(), "crosses regions") {
		t.Fatalf("AU cash was recorded as an IDR purchase: %v", err)
	}
}

func TestABurnCannotCrossRegions(t *testing.T) {
	book, pool := newLedger(t)
	owner := ownerPool(t)
	for _, a := range append(ledger.PlatformChart(au), ledger.PlatformChart(id)...) {
		insert(t, pool, a)
	}
	// Unguarded contra accounts, so only the region wall can refuse it.
	points, err := transfer(book, []ledger.Entry{
		{AccountID: plat(au, ledger.RolePointsIssued), AmountMinor: -10, Currency: "YTP"},
		{AccountID: plat(au, ledger.RolePointsRedeemed), AmountMinor: 10, Currency: "YTP"},
	})
	if err != nil {
		t.Fatal(err)
	}
	idLiability, err := transfer(book, []ledger.Entry{
		{AccountID: plat(id, ledger.RoleRedemptionClearing), AmountMinor: -600, Currency: "IDR"},
		{AccountID: plat(id, ledger.RoleVoucherLiability), AmountMinor: 600, Currency: "IDR"},
	})
	if err != nil {
		t.Fatal(err)
	}
	err = rawTx(t, owner, sql(`INSERT INTO ledger.burn (saga_id, user_id, region, points, settlement_minor,
		points_transfer_id, liability_transfer_id) VALUES ($1, 'u-wall', 'AU', 10, 600, $2, $3)`,
		unique("saga"), points.TransferID, idLiability.TransferID))
	if err == nil || !strings.Contains(err.Error(), "crosses regions") {
		t.Fatalf("AU points bought an ID voucher liability: %v", err)
	}
}

// A price in one currency can only name a rate of that currency.
func TestAPriceCannotUseTheOtherRegionsRate(t *testing.T) {
	owner := ownerPool(t)
	ctx := context.Background()
	var idrRate string
	if err := owner.QueryRow(ctx, `SELECT id FROM ledger.backing_rate WHERE currency = 'IDR' LIMIT 1`).Scan(&idrRate); err != nil {
		t.Skipf("no IDR rate seeded: %v", err)
	}
	for name, stmt := range map[string]string{
		"quote": `INSERT INTO ledger.quote (id, region, currency, settlement_minor, price_points, backing_rate_id, expires_at)
			VALUES (gen_random_uuid(), 'AU', 'AUD', 1000, 334, $1, now() + interval '15 minutes')`,
		"listing price": `INSERT INTO ledger.listing_price (listing_id, region, currency, settlement_minor, price_points, backing_rate_id)
			VALUES (gen_random_uuid(), 'AU', 'AUD', 1000, 334, $1)`,
	} {
		if err := rawTx(t, owner, sql(stmt, idrRate)); err == nil || !strings.Contains(err.Error(), "rate_in_its_currency") {
			t.Errorf("an AUD %s used the IDR rate: %v", name, err)
		}
	}
}
