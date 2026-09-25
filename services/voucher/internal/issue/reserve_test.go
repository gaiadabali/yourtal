package issue_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/testdb"
)

// 4.5.a: reserve/release/activate (the stock reservation) and D12 (a
// batch's terms are derived from its listing, and its supplier must match
// the listing's own merchant).

type fixture struct {
	minter *issue.Minter
	pool   *pgxpool.Pool
	owner  *pgxpool.Pool
}

func newFixture(t *testing.T) *fixture {
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

	keys, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeVoucherCode: {1: make([]byte, 32)},
	})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}

	return &fixture{minter: issue.New(pool, keys), pool: pool, owner: owner}
}

// seedListing inserts a listing with one branch, owned by a fresh merchant.
func (f *fixture) seedListing(t *testing.T) (listingID, merchantID uuid.UUID) {
	t.Helper()
	ctx := context.Background()

	listingID, merchantID = uuid.New(), uuid.New()
	locationID := uuid.New()

	if _, err := f.owner.Exec(ctx, `
		INSERT INTO store.listings
		  (id, merchant_id, merchant_name, title, description, category,
		   face_value_minor, settlement_value_minor, price_in_points,
		   stock_remaining, stock_total, transferable, partial_redemption_policy,
		   minimum_spend_minor, expires_at, status, currency, region, audience,
		   content_category, image_url, channel, partial_redemption)
		VALUES ($1, $2, 'Test Merchant', 'Test Listing', 'issue package test', 'food-and-drink',
		        50000, 15000, 1000, 10, 10, false, 'single_use_forfeit',
		        NULL, $3, 'available', 'IDR', 'ID', 'all_ages',
		        'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg', 'both', 'single_use')`,
		listingID, merchantID, time.Now().UTC().Add(90*24*time.Hour)); err != nil {
		t.Fatalf("inserting a test listing: %v", err)
	}
	if _, err := f.owner.Exec(ctx,
		`INSERT INTO store.merchant_location (id, merchant_id, name, address, district) VALUES ($1, $2, 'Branch', '1 St', 'District')`,
		locationID, merchantID); err != nil {
		t.Fatalf("inserting a test location: %v", err)
	}
	if _, err := f.owner.Exec(ctx,
		`INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`,
		listingID, locationID); err != nil {
		t.Fatalf("inserting a test listing's location: %v", err)
	}
	return listingID, merchantID
}

// mintOne requests, approves and mints one voucher against a fresh listing.
func (f *fixture) mintOne(t *testing.T) (listingID uuid.UUID) {
	t.Helper()
	ctx := context.Background()

	listingID, merchantID := f.seedListing(t)
	batchID := uuid.New()
	if err := f.minter.RequestBatch(ctx, issue.BatchRequest{
		ID: batchID, ListingID: listingID, SupplierBusinessID: merchantID,
		RequestedBy: "staff-1", Quantity: 1, FundingReference: "test",
	}); err != nil {
		t.Fatalf("RequestBatch: %v", err)
	}
	if err := f.minter.Approve(ctx, batchID, "staff-2"); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if _, err := f.minter.Mint(ctx, batchID); err != nil {
		t.Fatalf("Mint: %v", err)
	}
	return listingID
}

func TestReserveClaimsAMintedVoucher(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	listingID := f.mintOne(t)

	reserved, err := f.minter.Reserve(ctx, listingID, uuid.NewString())
	if err != nil {
		t.Fatalf("Reserve: %v", err)
	}
	if reserved.State != lifecycle.Allocated {
		t.Errorf("state = %s, want allocated", reserved.State)
	}
}

func TestReserveRefusesAnEmptyListing(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	listingID, _ := f.seedListing(t) // no batch minted against it

	_, err := f.minter.Reserve(ctx, listingID, uuid.NewString())
	if !errors.Is(err, issue.ErrOutOfStock) {
		t.Fatalf("Reserve on an empty listing gave %v, want ErrOutOfStock", err)
	}
}

func TestReserveIsIdempotentPerSaga(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	listingID := f.mintOne(t)
	sagaID := uuid.NewString()

	first, err := f.minter.Reserve(ctx, listingID, sagaID)
	if err != nil {
		t.Fatalf("first Reserve: %v", err)
	}
	second, err := f.minter.Reserve(ctx, listingID, sagaID)
	if err != nil {
		t.Fatalf("second Reserve: %v", err)
	}
	if first.VoucherID != second.VoucherID {
		t.Errorf("a retried reserve for the same saga claimed a different voucher: %s vs %s",
			first.VoucherID, second.VoucherID)
	}
}

func TestReleaseReturnsAReservationToInventory(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	listingID := f.mintOne(t)
	sagaID := uuid.NewString()

	if _, err := f.minter.Reserve(ctx, listingID, sagaID); err != nil {
		t.Fatalf("Reserve: %v", err)
	}
	released, err := f.minter.ReleaseReservation(ctx, sagaID)
	if err != nil {
		t.Fatalf("ReleaseReservation: %v", err)
	}
	if released.State != lifecycle.Minted {
		t.Errorf("state = %s, want minted", released.State)
	}

	// The voucher is claimable again — a second saga on the same listing
	// gets it back, proving `release` actually returned it to inventory
	// rather than leaving it stuck.
	reclaimed, err := f.minter.Reserve(ctx, listingID, uuid.NewString())
	if err != nil {
		t.Fatalf("re-reserving after release: %v", err)
	}
	if reclaimed.VoucherID != released.VoucherID {
		t.Errorf("release did not free the same voucher for reclaiming")
	}
}

func TestActivateHandsTheReservationToItsOwner(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	listingID := f.mintOne(t)
	sagaID := uuid.NewString()
	owner := uuid.New()

	if _, err := f.minter.Reserve(ctx, listingID, sagaID); err != nil {
		t.Fatalf("Reserve: %v", err)
	}
	activated, err := f.minter.ActivateReservation(ctx, sagaID, owner)
	if err != nil {
		t.Fatalf("ActivateReservation: %v", err)
	}
	if activated.State != lifecycle.Active {
		t.Errorf("state = %s, want active", activated.State)
	}

	var ownerID uuid.UUID
	if err := f.pool.QueryRow(ctx,
		`SELECT owner_id FROM voucher.vouchers WHERE id = $1`, activated.VoucherID).Scan(&ownerID); err != nil {
		t.Fatalf("reading owner: %v", err)
	}
	if ownerID != owner {
		t.Errorf("owner_id = %s, want %s", ownerID, owner)
	}
}

func TestActivateIsIdempotentAfterALostResponse(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	listingID := f.mintOne(t)
	sagaID := uuid.NewString()
	owner := uuid.New()

	if _, err := f.minter.Reserve(ctx, listingID, sagaID); err != nil {
		t.Fatalf("Reserve: %v", err)
	}
	first, err := f.minter.ActivateReservation(ctx, sagaID, owner)
	if err != nil {
		t.Fatalf("first ActivateReservation: %v", err)
	}
	second, err := f.minter.ActivateReservation(ctx, sagaID, owner)
	if err != nil {
		t.Fatalf("retried ActivateReservation: %v", err)
	}
	if first.VoucherID != second.VoucherID || second.State != lifecycle.Active {
		t.Errorf("a retried activate did not return the same, still-active voucher: %+v then %+v", first, second)
	}
}

// D12: a batch's terms are derived from its listing, and its supplier must
// match the listing's own merchant.

func TestRequestBatchRefusesAWrongSupplier(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	listingID, _ := f.seedListing(t)

	err := f.minter.RequestBatch(ctx, issue.BatchRequest{
		ID: uuid.New(), ListingID: listingID, SupplierBusinessID: uuid.New(), // not the listing's merchant
		RequestedBy: "staff-1", Quantity: 1, FundingReference: "test",
	})
	if !errors.Is(err, issue.ErrWrongSupplier) {
		t.Fatalf("RequestBatch with the wrong supplier gave %v, want ErrWrongSupplier", err)
	}
}

func TestRequestBatchDerivesTermsFromTheListingNotTheCaller(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	listingID, merchantID := f.seedListing(t) // face 50,000 IDR, single_use_forfeit

	batchID := uuid.New()
	// A caller claiming face 500,000 in AUD, balance_carrying — every one of
	// these must be ignored in favour of the listing's own terms.
	if err := f.minter.RequestBatch(ctx, issue.BatchRequest{
		ID: batchID, ListingID: listingID, SupplierBusinessID: merchantID,
		RequestedBy: "staff-1", Quantity: 1, FundingReference: "test",
		FaceValueMinor: 500_000, Currency: "AUD", PartialPolicy: "balance_carrying",
	}); err != nil {
		t.Fatalf("RequestBatch: %v", err)
	}

	var faceValueMinor int64
	var currency, policy string
	if err := f.pool.QueryRow(ctx,
		`SELECT face_value_minor, currency, partial_redemption_policy FROM voucher.batch WHERE id = $1`,
		batchID).Scan(&faceValueMinor, &currency, &policy); err != nil {
		t.Fatalf("reading the batch: %v", err)
	}
	if faceValueMinor != 50_000 || currency != "IDR" || policy != "single_use_forfeit" {
		t.Errorf("batch terms = (%d, %s, %s), want the listing's own (50000, IDR, single_use_forfeit)",
			faceValueMinor, currency, policy)
	}
}
