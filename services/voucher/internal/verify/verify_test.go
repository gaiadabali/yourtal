package verify_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/testdb"
	"github.com/yourtal/services/voucher/internal/verify"
)

// Mints REAL vouchers through issue.Minter (the same request/approve/mint
// path production uses), not a hand-built code_custody row — code_custody
// has an FK on voucher.vouchers, and the seed data already in this test
// database rules out ever observing it truly empty, so there is no shortcut
// worth taking here anyway.

func ring(t *testing.T, seed byte) *keyring.Keyring {
	t.Helper()
	key := make([]byte, 32)
	for i := range key {
		key[i] = seed + byte(i)
	}
	k, err := keyring.New(map[keyring.Purpose]map[int][]byte{keyring.PurposeVoucherCode: {1: key}})
	if err != nil {
		t.Fatalf("keyring.New: %v", err)
	}
	return k
}

// mintOne seeds one listing and mints one voucher against it, sealed with
// keys — a copy of internal/issue/reserve_test.go's fixture, kept minimal
// (this package only needs code_custody rows to exist, not the reservation
// lifecycle reserve_test.go exercises).
func mintOne(t *testing.T, keys *keyring.Keyring) {
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

	owner, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatalf("connect as owner: %v", err)
	}
	t.Cleanup(owner.Close)

	listingID, merchantID, locationID := uuid.New(), uuid.New(), uuid.New()
	if _, err := owner.Exec(ctx, `
		INSERT INTO store.listings
		  (id, merchant_id, merchant_name, title, description, category,
		   face_value_minor, settlement_value_minor, price_in_points,
		   stock_remaining, stock_total, transferable, partial_redemption_policy,
		   minimum_spend_minor, expires_at, status, currency, region, audience,
		   content_category, image_url, channel, partial_redemption)
		VALUES ($1, $2, 'Test Merchant', 'Test Listing', 'verify package test', 'food-and-drink',
		        50000, 15000, 1000, 10, 10, false, 'single_use_forfeit',
		        NULL, $3, 'available', 'IDR', 'ID', 'all_ages',
		        'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg', 'both', 'single_use')`,
		listingID, merchantID, time.Now().UTC().Add(90*24*time.Hour)); err != nil {
		t.Fatalf("inserting a test listing: %v", err)
	}
	if _, err := owner.Exec(ctx,
		`INSERT INTO store.merchant_location (id, merchant_id, name, address, district) VALUES ($1, $2, 'Branch', '1 St', 'District')`,
		locationID, merchantID); err != nil {
		t.Fatalf("inserting a test location: %v", err)
	}
	if _, err := owner.Exec(ctx,
		`INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`,
		listingID, locationID); err != nil {
		t.Fatalf("inserting a test listing's location: %v", err)
	}

	minter := issue.New(pool, keys)
	batchID := uuid.New()
	if err := minter.RequestBatch(ctx, issue.BatchRequest{
		ID: batchID, ListingID: listingID, SupplierBusinessID: merchantID,
		RequestedBy: "staff-1", Quantity: 1, FundingReference: "test",
	}); err != nil {
		t.Fatalf("RequestBatch: %v", err)
	}
	if err := minter.Approve(ctx, batchID, "staff-2"); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if _, err := minter.Mint(ctx, batchID); err != nil {
		t.Fatalf("Mint: %v", err)
	}
}

func connect(t *testing.T) *pgxpool.Pool {
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
	return pool
}

// limit=1 against a query ordered newest-first is what makes these
// deterministic despite running against the same shared test database every
// other package's tests also mint vouchers into: the row this test just
// inserted is necessarily the newest when the query runs, because nothing
// else writes to this database while a single test function is executing
// (no test in this suite calls t.Parallel()).

func TestBackupOpensCodesSealedWithTheMatchingKeyring(t *testing.T) {
	keys := ring(t, 1)
	mintOne(t, keys)
	pool := connect(t)

	result, err := verify.Backup(context.Background(), pool, keys, 1, false)
	if err != nil {
		t.Fatalf("Backup: %v", err)
	}
	if result.Total != 1 || result.Opened != 1 {
		t.Fatalf("expected the just-minted row to open, got opened=%d total=%d", result.Opened, result.Total)
	}
}

func TestBackupFailsToOpenWithTheWrongKeyring(t *testing.T) {
	sealedWith := ring(t, 10)
	mintOne(t, sealedWith)
	openedWith := ring(t, 20)
	pool := connect(t)

	result, err := verify.Backup(context.Background(), pool, openedWith, 1, false)
	if err != nil {
		t.Fatalf("Backup: %v", err)
	}
	if result.Total != 1 || result.Opened != 0 {
		t.Fatalf("expected the just-minted row to fail with the wrong keyring, got opened=%d total=%d",
			result.Opened, result.Total)
	}
}
