package redeem_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/code"
	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/redeem"
)

// The whole redemption network, end to end, against the real Postgres from
// `pnpm dev:up`.
//
// Nothing here is faked. The invariants that matter in this subsystem are
// database constraints — one live hold per voucher, a capture that cannot
// exceed its authorization, refunds bounded at COMMIT — and a fake would
// assert that the code calls them, which was never the question.
//
// As `yourtal_voucher`: the service's own role. Running as the owner would
// pass while proving nothing about whether the grants it actually deploys
// with are sufficient.
const (
	defaultURL      = "postgres://yourtal_voucher:voucher_local_only@127.0.0.1:26432/yourtal"
	defaultOwnerURL = "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal"
)

type fixture struct {
	minter  *issue.Minter
	network *redeem.Network
	pool    *pgxpool.Pool
	// The seeded listing every batch is minted against, and the merchant
	// that listing belongs to — which is who may redeem its vouchers.
	listingID  uuid.UUID
	merchantID uuid.UUID
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()

	url := os.Getenv("VOUCHER_DATABASE_URL")
	if url == "" {
		url = defaultURL
	}

	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("no local Postgres (run `pnpm dev:up`): %v", err)
	}
	t.Cleanup(pool.Close)

	// A deterministic keyring. Real deployments load master keys from
	// outside the repo; a test that needed a filesystem to exercise AES
	// would be testing the loader instead of the redemption network.
	keys, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeVoucherCode: {1: make([]byte, 32)},
	})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}

	var listingID, merchantID uuid.UUID
	err = pool.QueryRow(ctx,
		`SELECT l.id, l.merchant_id FROM store.listings l
		   JOIN store.listing_location ll ON ll.listing_id = l.id
		  ORDER BY l.id LIMIT 1`).Scan(&listingID, &merchantID)
	if err != nil {
		t.Skipf("run `pnpm db:seed` first — this needs a listing with a branch: %v", err)
	}

	return &fixture{
		minter:     issue.New(pool, keys),
		network:    redeem.New(pool),
		pool:       pool,
		listingID:  listingID,
		merchantID: merchantID,
	}
}

// mintOne runs the full issuance path and returns one active voucher plus
// its code, ready to be presented at a till.
func (f *fixture) mintOne(t *testing.T, policy string, faceMinor int64, minimum *int64) (uuid.UUID, string) {
	t.Helper()
	ctx := context.Background()

	batchID := uuid.New()
	requester, approver := uuid.New(), uuid.New()

	if err := f.minter.RequestBatch(ctx, issue.BatchRequest{
		ID:                   batchID,
		ListingID:            f.listingID,
		SupplierBusinessID:   uuid.New(),
		RequestedBy:          requester,
		Quantity:             1,
		FaceValueMinor:       faceMinor,
		SettlementValueMinor: faceMinor / 3,
		Currency:             "IDR",
		Transferable:         false,
		PartialPolicy:        policy,
		MinimumSpendMinor:    minimum,
		ExpiresAt:            time.Now().UTC().Add(90 * 24 * time.Hour),
		FundingReference:     "probe-funding",
	}); err != nil {
		t.Fatalf("RequestBatch: %v", err)
	}

	if err := f.minter.Approve(ctx, batchID, approver); err != nil {
		t.Fatalf("Approve: %v", err)
	}

	result, err := f.minter.Mint(ctx, batchID)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if len(result.VoucherIDs) != 1 {
		t.Fatalf("minted %d vouchers, want 1", len(result.VoucherIDs))
	}

	voucherID := result.VoucherIDs[0]
	owner := uuid.New()
	if err := f.minter.Allocate(ctx, voucherID, owner); err != nil {
		t.Fatalf("Allocate: %v", err)
	}
	if err := f.minter.Activate(ctx, voucherID); err != nil {
		t.Fatalf("Activate: %v", err)
	}

	plaintext, err := f.minter.Reveal(ctx, voucherID)
	if err != nil {
		t.Fatalf("Reveal: %v", err)
	}
	return voucherID, plaintext
}

func orderRef() string { return fmt.Sprintf("probe-%d", time.Now().UnixNano()) }

// The whole loop: mint, hand it to a user, spend part of it at a till.
func TestABalanceCarryingVoucherSpendsDownAndStaysActive(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000_00, nil)

	// The code must survive the round trip through envelope encryption and
	// still pass its own check symbol — otherwise nothing a cashier types
	// could ever match.
	if _, err := code.Parse(plaintext); err != nil {
		t.Fatalf("a revealed code does not parse: %v", err)
	}

	authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 30_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}

	capture, err := f.network.Capture(ctx, authorization.ID, 30_000_00, orderRef())
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}

	// docs/09 §8.2's gift-card behaviour: IDR 50,000 voucher on a IDR 30,000
	// order leaves IDR 20,000.
	if capture.RemainingMinor != 20_000_00 {
		t.Errorf("remaining %d, want 2000000 (IDR 20,000 in sen)", capture.RemainingMinor)
	}
	if state := f.stateOf(t, voucherID); state != "active" {
		t.Errorf("a part-spent balance-carrying voucher is %q, want active", state)
	}

	// And the history verifies: minted, allocated, activated, authorized,
	// captured — each committing to the last.
	if err := f.minter.VerifyChain(ctx, voucherID); err != nil {
		t.Errorf("the event chain does not verify: %v", err)
	}
}

// The coupon. A user who loses value they did not expect to lose never
// trusts the store again — so the behaviour is per batch, and it is applied
// in exactly one place.
func TestASingleUseVoucherIsConsumedWhatever1sSpent(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	voucherID, plaintext := f.mintOne(t, "single_use_forfeit", 50_000_00, nil)

	authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}
	capture, err := f.network.Capture(ctx, authorization.ID, 10_000_00, orderRef())
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}

	if capture.RemainingMinor != 0 {
		t.Errorf("a forfeited remainder left %d behind", capture.RemainingMinor)
	}
	if state := f.stateOf(t, voucherID); state != "redeemed" {
		t.Errorf("state %q, want redeemed", state)
	}
}

func TestAMinimumSpendVoucherRefusesASmallOrder(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	minimum := int64(25_000_00)
	_, plaintext := f.mintOne(t, "minimum_spend", 50_000_00, &minimum)

	_, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if !errors.Is(err, redeem.ErrBelowMinimumSpend) {
		t.Fatalf("an order below the minimum was accepted: %v", err)
	}

	// The one refusal a cashier can act on, so it names the threshold. Every
	// other refusal is deliberately opaque.
	if err != nil && !contains(err.Error(), "2500000") {
		t.Errorf("the refusal does not tell the till the threshold: %v", err)
	}

	// And above it, the same voucher works.
	if _, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 30_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	}); err != nil {
		t.Fatalf("an order above the minimum was refused: %v", err)
	}
}

func (f *fixture) stateOf(t *testing.T, voucherID uuid.UUID) string {
	t.Helper()
	var state string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT state FROM voucher.vouchers WHERE id = $1`, voucherID).Scan(&state); err != nil {
		t.Fatalf("reading state: %v", err)
	}
	return state
}

// asOwner opens a connection with the database owner's credential.
//
// Only for tests that must damage something the voucher service itself is
// not allowed to damage — the event log, which the service can append to and
// not rewrite. A test that needed this to do ordinary work would be a test
// running with rights the service does not have, which is exactly the kind
// that passes while the deployed grants are wrong.
func (f *fixture) asOwner(t *testing.T) *pgxpool.Pool {
	t.Helper()

	url := os.Getenv("OWNER_DATABASE_URL")
	if url == "" {
		url = defaultOwnerURL
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("connect as owner: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func contains(haystack, needle string) bool {
	for index := 0; index+len(needle) <= len(haystack); index++ {
		if haystack[index:index+len(needle)] == needle {
			return true
		}
	}
	return false
}
