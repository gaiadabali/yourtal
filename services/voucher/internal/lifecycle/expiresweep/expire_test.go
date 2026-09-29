package expiresweep_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/lifecycle/expiresweep"
	"github.com/yourtal/services/voucher/internal/testdb"
)

// Real Postgres, `yourtal_voucher`'s own role, same reasoning
// redeem_test.go's own header gives: the invariants that matter here are
// database constraints (the lifecycle transition, the outbox rows landing
// in the same transaction as the state change), and a fake would only
// assert that this code calls them.

func setup(t *testing.T) (*pgxpool.Pool, *pgxpool.Pool, *issue.Minter, uuid.UUID, uuid.UUID) {
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

	var merchantID, locationID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT l.merchant_id, ll.location_id FROM store.listings l
		   JOIN store.listing_location ll ON ll.listing_id = l.id
		  ORDER BY l.id LIMIT 1`).Scan(&merchantID, &locationID); err != nil {
		t.Skipf("run `pnpm db:seed` first — this needs a listing with a branch: %v", err)
	}

	return pool, owner, issue.New(pool, keys), merchantID, locationID
}

// mintActiveVoucher runs the full issuance saga (request, approve, mint,
// reserve, activate — the same production path redeem_test.go's own
// mintOne uses) against a throwaway listing, and returns one Active voucher.
func mintActiveVoucher(
	t *testing.T, owner *pgxpool.Pool, minter *issue.Minter, merchantID, locationID uuid.UUID,
) uuid.UUID {
	t.Helper()
	ctx := context.Background()

	listingID := uuid.New()
	if _, err := owner.Exec(ctx, `
		INSERT INTO store.listings
		  (id, merchant_id, merchant_name, title, description, category,
		   face_value_minor, settlement_value_minor, price_in_points,
		   stock_remaining, stock_total, transferable, partial_redemption_policy,
		   minimum_spend_minor, expires_at, status, currency, region, audience,
		   content_category, image_url, channel, partial_redemption)
		VALUES ($1, $2, 'Test Merchant', 'Test Listing', 'a listing minted for one test', 'food-and-drink',
		        50000, 16000, 1, 1, 1, false, 'balance_carrying',
		        NULL, $3, 'available', 'IDR', 'ID', 'all_ages',
		        'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg', 'both', 'single_use')`,
		listingID, merchantID, time.Now().UTC().Add(90*24*time.Hour)); err != nil {
		t.Fatalf("inserting a test listing: %v", err)
	}
	if _, err := owner.Exec(ctx,
		`INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`,
		listingID, locationID); err != nil {
		t.Fatalf("inserting a test listing's location: %v", err)
	}

	batchID := uuid.New()
	if err := minter.RequestBatch(ctx, issue.BatchRequest{
		ID: batchID, ListingID: listingID, SupplierBusinessID: merchantID,
		RequestedBy: "test-requester", Quantity: 1, Transferable: false, FundingReference: "probe-funding",
	}); err != nil {
		t.Fatalf("RequestBatch: %v", err)
	}
	if err := minter.Approve(ctx, batchID, "test-approver"); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	result, err := minter.Mint(ctx, batchID)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if len(result.VoucherIDs) != 1 {
		t.Fatalf("minted %d vouchers, want 1", len(result.VoucherIDs))
	}

	sagaID := uuid.NewString()
	if _, err := minter.Reserve(ctx, listingID, sagaID); err != nil {
		t.Fatalf("Reserve: %v", err)
	}
	owningUser := uuid.New()
	reservation, err := minter.ActivateReservation(ctx, sagaID, owningUser)
	if err != nil {
		t.Fatalf("ActivateReservation: %v", err)
	}
	return reservation.VoucherID
}

func TestSweepDueExpiresAnOverdueActiveVoucher(t *testing.T) {
	pool, owner, minter, merchantID, locationID := setup(t)
	ctx := context.Background()
	voucherID := mintActiveVoucher(t, owner, minter, merchantID, locationID)

	// Clock-shift into the past — the same technique the ledger's own
	// expiry test uses for last_activity_at. yourtal_voucher has no UPDATE
	// on voucher.vouchers.expires_at from the API surface, but this is the
	// owner connection, standing in for "however long ago this voucher was
	// actually minted".
	// issued_at moves back too: vouchers_expires_after_issue refuses an
	// expiry before the issue date, and issued_at defaults to mint time (now).
	if _, err := owner.Exec(ctx,
		`UPDATE voucher.vouchers SET issued_at = now() - interval '2 days', expires_at = now() - interval '1 day'
		  WHERE id = $1`, voucherID); err != nil {
		t.Fatalf("clock-shifting expires_at: %v", err)
	}

	sweeper := expiresweep.NewSweeper(pool)
	expired, err := sweeper.SweepDue(ctx)
	if err != nil {
		t.Fatalf("SweepDue: %v", err)
	}
	if expired < 1 {
		t.Fatalf("expired = %d, want at least 1 (this test's own voucher)", expired)
	}

	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM voucher.vouchers WHERE id = $1`, voucherID).Scan(&state); err != nil {
		t.Fatalf("reading voucher state: %v", err)
	}
	if state != "expired" {
		t.Errorf("state = %s, want expired", state)
	}

	var webhookCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM voucher.webhook_outbox WHERE event_type = 'voucher.expired'
		   AND idempotency_key = $1`,
		"voucher_expired_"+voucherID.String()).Scan(&webhookCount); err != nil {
		t.Fatalf("reading webhook outbox: %v", err)
	}
	if webhookCount != 1 {
		t.Errorf("webhook_outbox rows for this voucher = %d, want 1", webhookCount)
	}

	var outboxAmount int64
	var posted *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT amount_minor, posted_at FROM voucher.expiry_outbox WHERE voucher_id = $1`,
		voucherID).Scan(&outboxAmount, &posted); err != nil {
		t.Fatalf("reading expiry outbox: %v", err)
	}
	if outboxAmount != 50_000 {
		t.Errorf("expiry_outbox amount = %d, want 50000 (the face value, never redeemed from)", outboxAmount)
	}
	if posted != nil {
		t.Error("expiry_outbox was already marked posted — nothing has drained it in this test")
	}

	// A second sweep against the same, now-Expired voucher does nothing more.
	again, err := sweeper.SweepDue(ctx)
	if err != nil {
		t.Fatalf("second SweepDue: %v", err)
	}
	if again != 0 {
		t.Errorf("a second sweep moved %d more vouchers, want 0 (already expired)", again)
	}
}

func TestSweepDueLeavesAnUnexpiredVoucherAlone(t *testing.T) {
	pool, owner, minter, merchantID, locationID := setup(t)
	ctx := context.Background()
	voucherID := mintActiveVoucher(t, owner, minter, merchantID, locationID)

	if _, err := expiresweep.NewSweeper(pool).SweepDue(ctx); err != nil {
		t.Fatalf("SweepDue: %v", err)
	}

	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM voucher.vouchers WHERE id = $1`, voucherID).Scan(&state); err != nil {
		t.Fatalf("reading voucher state: %v", err)
	}
	if state != "active" {
		t.Errorf("state = %s, want active (its expires_at is 90 days out)", state)
	}
}
